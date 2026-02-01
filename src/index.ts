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
    const colorMap: Map<string, number> = new Map();
    const palette: number[] = [];
    const indices: number[] = [];
    
    for (let i = 0; i < imageData.length; i += 4) {
        const r = imageData[i];
        const g = imageData[i + 1];
        const b = imageData[i + 2];
        
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
    
    while (palette.length < 768) {
        palette.push(0, 0, 0);
    }
    
    const gif: number[] = [];
    gif.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
    gif.push(width & 0xff, width >> 8);
    gif.push(height & 0xff, height >> 8);
    gif.push(0xF7, 0x00, 0x00);
    gif.push(...palette);
    gif.push(0x21, 0xF9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00);
    gif.push(0x2C, 0x00, 0x00, 0x00, 0x00);
    gif.push(width & 0xff, width >> 8);
    gif.push(height & 0xff, height >> 8);
    gif.push(0x00, 0x08);
    
    const maxBlockSize = 255;
    for (let i = 0; i < indices.length; i += maxBlockSize) {
        const blockSize = Math.min(maxBlockSize, indices.length - i);
        gif.push(blockSize);
        for (let j = 0; j < blockSize; j++) {
            gif.push(indices[i + j]);
        }
    }
    
    gif.push(0x00, 0x3B);
    return new Uint8Array(gif);
}

async function convertImageToGif(imageFile: File, width?: number, height?: number): Promise<File> {
    const avatar = await loadImage(imageFile);

    let gifWidth = width && height ? width : width ? width : height ? Math.round((avatar.width / avatar.height) * height) : avatar.width;
    let gifHeight = width && height ? height : height ? height : width ? Math.round((avatar.height / avatar.width) * width) : avatar.height;

    const canvas = document.createElement("canvas");
    canvas.width = gifWidth;
    canvas.height = gifHeight;
    const ctx = canvas.getContext("2d");
    
    if (!ctx) throw new Error("Could not get canvas context");

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(avatar, 0, 0, avatar.width, avatar.height, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const gifData = createGIF(imageData.data, canvas.width, canvas.height);
    
    const originalName = imageFile.name ? imageFile.name.replace(/\.[^/.]+$/, "") : "converted";
    return new File([gifData], `${originalName}.gif`, { type: "image/gif" });
}

let unregisterCommand: (() => void) | undefined;

export default {
    onLoad: () => {
        unregisterCommand = registerCommand({
            name: "imgtogif",
            displayName: "Image to GIF",
            description: "Convert image to GIF. Uses last image in chat, or provide url:IMAGE_URL",
            options: [
                {
                    name: "url",
                    displayName: "url",
                    description: "Image URL (optional - uses last image if omitted)",
                    required: false,
                    type: 3
                },
                {
                    name: "width",
                    displayName: "width",
                    description: "Width of output GIF (optional)",
                    required: false,
                    type: 4
                },
                {
                    name: "height",
                    displayName: "height",
                    description: "Height of output GIF (optional)",
                    required: false,
                    type: 4
                }
            ],
            execute: async (args, ctx) => {
                try {
                    let imageUrl: string | null = null;
                    let width: number | undefined;
                    let height: number | undefined;

                    for (const arg of args) {
                        if (arg.name === "url") imageUrl = arg.value as string;
                        else if (arg.name === "width") width = Number(arg.value);
                        else if (arg.name === "height") height = Number(arg.value);
                    }

                    if (!imageUrl) {
                        const messages = MessageStore?.getMessages?.(ctx.channel.id)?._array || [];
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
                                { content: "❌ No image found! Send an image first or use: /imgtogif url:YOUR_URL" },
                                void 0,
                                { nonce: Date.now().toString() }
                            );
                            return;
                        }
                        
                        imageUrl = imageAttachment.url;
                    }

                    messageUtil.sendMessage(
                        ctx.channel.id,
                        { content: "🔄 Converting to GIF..." },
                        void 0,
                        { nonce: Date.now().toString() }
                    );

                    const response = await fetch(imageUrl);
                    const blob = await response.blob();
                    const filename = imageUrl.split('/').pop() || "image.png";
                    const file = new File([blob], filename, { type: blob.type });

                    const outputFile = await convertImageToGif(file, width, height);

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
