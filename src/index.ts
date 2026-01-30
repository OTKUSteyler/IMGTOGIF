import { registerCommand } from "@vendetta/commands";
import { findByProps } from "@vendetta/metro";

let GIFEncoder: any, quantize: any, applyPalette: any;

const messageUtil = findByProps("sendMessage", "editMessage");
const UploadHandler = findByProps("promptToUpload");
const UploadManager = findByProps("clearAll", "upload");

const FRAMES = 1;

async function loadGifEncoder() {
    if (GIFEncoder) return;
    
    try {
        // Try to import gifenc from a CDN
        const module = await import("https://esm.sh/gifenc@1.0.3");
        GIFEncoder = module.GIFEncoder;
        quantize = module.quantize;
        applyPalette = module.applyPalette;
    } catch (e) {
        console.error("[ImgToGif] Failed to load gifenc library:", e);
        throw new Error("Failed to load GIF encoding library");
    }
}

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

async function convertImageToGif(imageFile: File, width?: number, height?: number): Promise<File> {
    await loadGifEncoder();
    
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

    const gif = GIFEncoder();
    const canvas = document.createElement("canvas");
    canvas.width = gifWidth;
    canvas.height = gifHeight;
    const ctx = canvas.getContext("2d")!;

    for (let i = 0; i < FRAMES; i++) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(avatar, 0, 0, avatar.width, avatar.height, 0, 0, canvas.width, canvas.height);

        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const palette = quantize(data, 256);
        const index = applyPalette(data, palette);

        gif.writeFrame(index, canvas.width, canvas.height, {
            transparent: true,
            palette,
        });
    }

    gif.finish();
    const originalName = imageFile.name ? imageFile.name.replace(/\.[^/.]+$/, "") : "converted";
    const file = new File([new Uint8Array(gif.bytesView())], `${originalName}.gif`, { type: "image/gif" });
    
    return file;
}

let unregisterCommand: (() => void) | undefined;

export default {
    onLoad: () => {
        unregisterCommand = registerCommand({
            name: "imgtogif",
            displayName: "Image to GIF",
            description: "Convert an image to a GIF",
            options: [
                {
                    name: "image",
                    displayName: "image",
                    description: "Image attachment to convert",
                    required: true,
                    type: 11 // ATTACHMENT type
                },
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
                    // Extract arguments
                    let imageAttachment: any = null;
                    let width: number | undefined;
                    let height: number | undefined;

                    for (const arg of args) {
                        if (arg.name === "image") {
                            imageAttachment = arg.value;
                        } else if (arg.name === "width") {
                            width = Number(arg.value);
                        } else if (arg.name === "height") {
                            height = Number(arg.value);
                        }
                    }

                    if (!imageAttachment) {
                        messageUtil.sendMessage(
                            ctx.channel.id,
                            { content: "❌ No image specified! Please attach an image." },
                            void 0,
                            { nonce: Date.now().toString() }
                        );
                        return;
                    }

                    // Show processing message
                    messageUtil.sendMessage(
                        ctx.channel.id,
                        { content: "🔄 Converting image to GIF..." },
                        void 0,
                        { nonce: Date.now().toString() }
                    );

                    // Fetch the image file
                    const response = await fetch(imageAttachment.url);
                    const blob = await response.blob();
                    const file = new File([blob], imageAttachment.filename || "image.png", { type: blob.type });

                    // Check if it's actually an image
                    if (!file.type.startsWith("image/")) {
                        messageUtil.sendMessage(
                            ctx.channel.id,
                            { content: "❌ The attachment is not a valid image!" },
                            void 0,
                            { nonce: Date.now().toString() }
                        );
                        return;
                    }

                    // Convert to GIF
                    const gifFile = await convertImageToGif(file, width, height);

                    // Upload the GIF
                    if (UploadHandler?.promptToUpload) {
                        setTimeout(() => {
                            UploadHandler.promptToUpload([gifFile], ctx.channel, 0); // 0 = ChannelMessage draft type
                        }, 10);
                    } else {
                        messageUtil.sendMessage(
                            ctx.channel.id,
                            { content: "✅ GIF created! (Upload handler not available, cannot auto-upload)" },
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
