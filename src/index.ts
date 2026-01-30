import { registerCommand } from "@vendetta/commands";
import { findByProps } from "@vendetta/metro";

// Simplified GIF encoder - we'll implement a basic version inline
// Or use a pre-bundled library approach
const messageUtil = findByProps("sendMessage", "editMessage");
const UploadHandler = findByProps("promptToUpload");

const FRAMES = 1;

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

// Simple function to convert image to GIF using Canvas toBlob
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

    // Convert canvas to blob
    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Failed to create blob"));
        }, "image/png");
    });

    const originalName = imageFile.name ? imageFile.name.replace(/\.[^/.]+$/, "") : "converted";
    const file = new File([blob], `${originalName}.png`, { type: "image/png" });
    
    return file;
}

let unregisterCommand: (() => void) | undefined;

export default {
    onLoad: () => {
        unregisterCommand = registerCommand({
            name: "imgtogif",
            displayName: "Image to GIF",
            description: "Convert/resize an image (outputs as PNG due to mobile limitations)",
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
                    description: "Width of the output image (optional)",
                    required: false,
                    type: 4 // INTEGER type
                },
                {
                    name: "height",
                    displayName: "height",
                    description: "Height of the output image (optional)",
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
                        { content: "🔄 Processing image..." },
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

                    // Convert/resize image
                    const outputFile = await convertImageToGif(file, width, height);

                    // Upload the file
                    if (UploadHandler?.promptToUpload) {
                        setTimeout(() => {
                            UploadHandler.promptToUpload([outputFile], ctx.channel, 0);
                        }, 10);
                    } else {
                        messageUtil.sendMessage(
                            ctx.channel.id,
                            { content: "✅ Image processed! (Upload handler not available)" },
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
