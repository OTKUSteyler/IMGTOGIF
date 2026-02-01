import { registerCommand } from "@vendetta/commands";
import { findByProps, findByStoreName } from "@vendetta/metro";

const messageUtil = findByProps("sendMessage", "editMessage");
const UploadHandler = findByProps("promptToUpload");
const MessageStore = findByStoreName("MessageStore");

function loadImage(source: File | string): Promise<HTMLImageElement> {
    const isFile = source instanceof File;
    const url = isFile ? URL.createObjectURL(source) : source;

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            if (isFile) URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = (event, _source, _lineno, _colno, err) => reject(err || event);
        img.crossOrigin = "Anonymous";
        img.src = url;
    });
}

// Simple GIF encoder using the GIF89a format
function createGIF(imageData: Uint8ClampedArray, width: number, height: number): Uint8Array {
    // Simplified color quantization - reduce to 256 colors
    const colorMap: Map<string, number> = new Map();
    const palette: number[] = [];
    const indices: number[] = [];
    
    // Build color palette and index array
    for (let i = 0; i < imageData.length; i += 4) {
        const r = imageData[i];
        const g = imageData[i + 1];
        const b = imageData[i + 2];
        const a = imageData[i + 3];
        
        // Quantize colors to reduce palette size
        const qr = Math.floor(r / 16) * 16;
        const qg = Math.floor(g / 16) * 16;
        const qb = Math.floor(b / 16) * 16;
        
        const key = `${qr},${qg},${qb}`;
        
        if (!colorMap.has(key) && palette.length < 768) {
            colorMap.set(key, palette.length / 3);
            palette.push(qr, qg, qb);
        }
        
        indices.push(colorMap.get(key) || 0);
    }
    
    // Pad palette to 256 colors
    while (palette.length < 768) {
        palette.push(0, 0, 0);
    }
    
    // Build GIF file
    const gif: number[] = [];
    
    // Header
    gif.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // "GIF89a"
    
    // Logical Screen Descriptor
    gif.push(width & 0xff, width >> 8); // Width
    gif.push(height & 0xff, height >> 8); // Height
    gif.push(0xF7); // GCT follows, 256 colors, sorted, 8 bits per color
    gif.push(0x00); // Background color index
    gif.push(0x00); // Pixel aspect ratio
    
    // Global Color Table
    gif.push(...palette);
    
    // Graphics Control Extension (for transparency)
    gif.push(0x21, 0xF9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00);
    
    // Image Descriptor
    gif.push(0x2C); // Image separator
    gif.push(0x00, 0x00); // Left position
    gif.push(0x00, 0x00); // Top position
    gif.push(width & 0xff, width >> 8); // Width
    gif.push(height & 0xff, height >> 8); // Height
    gif.push(0x00); // No local color table
    
    // Image Data (LZW compressed)
    // Using minimum code size of 8 bits
    gif.push(0x08); // LZW minimum code size
    
    // Simplified: just output uncompressed blocks
    const maxBlockSize = 255;
    for (let i = 0; i < indices.length; i += maxBlockSize) {
        const blockSize = Math.min(maxBlockSize, indices.length - i);
        gif.push(blockSize);
        for (let j = 0; j < blockSize; j++) {
            gif.push(indices[i + j]);
        }
    }
    
    gif.push(0x00); // Block terminator
    gif.push(0x3B); // Trailer
    
    return new Uint8Array(gif);
}

async function convertImageToGif(imageFile: File, width?: number, height?: number): Promise<File> {
    const avatar = await loadImage(imageFile);

    let gifWidth: number;
    let gifHeight: number;

    if (width && height) {
        gifWidth = width;
        gifHeight = height;
    } else if (width) {
        gifWidth = width;
        gifHeight = Math.round((avatar.height / avatar.width) * width);
    } else if (height) {
        gifHeight = height;
        gifWidth = Math.round((avatar.width / avatar.height) * height);
    } else {
        gifWidth = avatar.width;
        gifHeight = avatar.height;
    }

    const canvas = document.createElement("canvas");
    canvas.width = gifWidth;
    canvas.height = gifHeight;
    const ctx = canvas.getContext("2d");
    
    if (!ctx) throw new Error("Could not get canvas context");

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(avatar, 0, 0, avatar.width, avatar.height, 0, 0, canvas.width, canvas.height);

    // Get image data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Create GIF
    const gifData = createGIF(imageData.data, canvas.width, canvas.height);
    
    const originalName = imageFile.name ? imageFile.name.replace(/\.[^/.]+$/, "") : "converted";
    const file = new File([gifData], `${originalName}.gif`, { type: "image/gif" });
    
    return file;
}

let unregisterCommand: (() => void) | undefined;

export default {
    onLoad: () => {
        unregisterCommand = registerCommand({
            name: "imgtogif",
            displayName: "Image to GIF",
            description: "Convert the last image in chat to GIF format",
            options: [
                {
                    name: "width",
                    displayName: "width",
                    description: "Width of the output GIF (optional)",
                    required: false,
                    type: 4 // INTEGER type
                },
                {
                    name: "height",
                    displayName: "height",
                    description: "Height of the output GIF (optional)",
                    required: false,
                    type: 4 // INTEGER type
                }
            ],
            execute: async (args, ctx) => {
                try {
                    let width: number | undefined;
                    let height: number | undefined;

                    for (const arg of args) {
                        if (arg.name === "width") {
                            width = Number(arg.value);
                        } else if (arg.name === "height") {
                            height = Number(arg.value);
                        }
                    }

                    // Get recent messages from the channel
                    const messages = MessageStore?.getMessages?.(ctx.channel.id)?._array || [];
                    
                    // Find the most recent message with an image attachment
                    let imageAttachment: any = null;
                    for (let i = messages.length - 1; i >= 0; i--) {
                        const msg = messages[i];
                        if (msg.attachments && msg.attachments.length > 0) {
                            for (const attachment of msg.attachments) {
                                if (attachment.content_type?.startsWith("image/") || 
                                    attachment.filename?.match(/\.(png|jpg|jpeg|gif|webp)$/i)) {
                                    imageAttachment = attachment;
                                    break;
                                }
                            }
                        }
                        if (imageAttachment) break;
                    }

                    if (!imageAttachment) {
                        messageUtil.sendMessage(
                            ctx.channel.id,
                            { content: "❌ No image found in recent messages! Please send an image first." },
                            void 0,
                            { nonce: Date.now().toString() }
                        );
                        return;
                    }

                    messageUtil.sendMessage(
                        ctx.channel.id,
                        { content: "🔄 Converting to GIF..." },
                        void 0,
                        { nonce: Date.now().toString() }
                    );

                    // Fetch the image
                    const response = await fetch(imageAttachment.url);
                    const blob = await response.blob();
                    const file = new File([blob], imageAttachment.filename || "image.png", { type: blob.type });

                    // Convert to GIF
                    const outputFile = await convertImageToGif(file, width, height);

                    // Upload
                    if (UploadHandler?.promptToUpload) {
                        setTimeout(() => {
                            UploadHandler.promptToUpload([outputFile], ctx.channel, 0);
                        }, 10);
                    } else {
                        messageUtil.sendMessage(
                            ctx.channel.id,
                            { content: "✅ GIF created! (Upload handler not available)" },
                            void 0,
                            { nonce: Date.now().toString() }
                        );
                    }
                } catch (err) {
                    console.error("[ImgToGif] Error:", err);
                    messageUtil.sendMessage(
                        ctx.channel.id,
                        { content: `❌ Error: ${String(err)}` },
                        void 0,
                        { nonce: Date.now().toString() }
                    );
                }
            },
            applicationId: "-1",
            inputType: 1,
            type: 1,
        });
    },
    
    onUnload: () => {
        if (unregisterCommand) {
            unregisterCommand();
        }
    }
};
