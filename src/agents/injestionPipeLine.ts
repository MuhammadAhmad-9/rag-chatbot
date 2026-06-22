import 'dotenv/config';
import { initPineconeIndex } from "./config/pinecone.config";
import * as path from 'path';
import * as fs from 'fs';
import { embedMany } from 'ai';
import { google } from '@ai-sdk/google';

// Helper function to build a cleaner text representation for embedding a single JSON object
function singleObjectToText(item: any): string {
    let text = '';
    for (const key in item) {
        if (item.hasOwnProperty(key)) {
            const value = item[key];
            if (value !== null && typeof value !== 'object') {
                text += `${key}: ${value}\n`;
            } else if (Array.isArray(value)) {
                text += `${key}: ${value.join(', ')}\n`;
            }
        }
    }
    return text.trim();
}

// Helper to sanitize JSON fields to match Pinecone metadata constraints (flat key-values, no nested objects)
function cleanMetadata(item: any): Record<string, any> {
    const meta: Record<string, any> = {};
    for (const key in item) {
        if (item.hasOwnProperty(key) && item[key] !== null) {
            const val = item[key];
            if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
                meta[key] = val;
            } else if (Array.isArray(val) && val.every(i => typeof i === 'string')) {
                meta[key] = val; // Pinecone natively supports string arrays
            } else if (typeof val === 'object') {
                meta[key] = JSON.stringify(val); // Safely flatten nested objects as strings
            }
        }
    }
    return meta;
}

export async function embedAndSave() {
    try {
        // 1. Initialize Pinecone connection
        const indexInstance = await initPineconeIndex();
        await indexInstance.deleteAll();
        if (!indexInstance) {
            throw new Error("Could not initialize Pinecone index instance.");
        }

        const dir = path.join(process.cwd(), '/src/agents/documents');
        if (!fs.existsSync(dir)) {
            console.error(`Directory not found: ${dir}`);
            return;
        }

        const files = fs.readdirSync(dir);

        for (const file of files) {
            const fileData = fs.readFileSync(path.join(dir, file), 'utf-8');
            let vectors: any[] = [];

            // --- JSON PROCESSING ---
            if (file.endsWith('.json')) {
                const result = JSON.parse(fileData);
                // Dynamically look for common array fields if it's a wrapper object
                const itemsArray = Array.isArray(result) ? result : (result.products || Object.values(result)[0]);

                if (!Array.isArray(itemsArray)) {
                    console.error(`Could not locate an iterable array inside ${file}`);
                    continue;
                }

                console.log(`Processing JSON file "${file}" with ${itemsArray.length} items.`);

                // Convert each object to a text string format for the embedding API
                const textsToEmbed = itemsArray.map(item => singleObjectToText(item));
                if (textsToEmbed.length === 0) continue;

                // Send items to the AI SDK Google Embedding endpoint
                const response = await embedMany({
                    model: google.textEmbeddingModel('gemini-embedding-2'),
                    values: textsToEmbed,
                    maxParallelCalls: 5,
                    providerOptions: {
                        google: {
                            taskType: 'RETRIEVAL_DOCUMENT',
                            outputDimensionality: 1536
                        }
                    }
                });

                // Map results into valid Pinecone vector configurations
                vectors = response.embeddings.map((embedding, index) => {
                    const originalItem = itemsArray[index];

                    const rawJsonId = originalItem.id || originalItem._id || originalItem.productId || originalItem.itemId;
                    let finalId = rawJsonId
                        ? `${file.replace(/[^a-zA-Z0-9]/g, '-')}-${rawJsonId}`
                        : `${file.replace(/[^a-zA-Z0-9]/g, '-')}-item-${index}`;

                   finalId = finalId.replace(/[^a-zA-Z0-9\-_:;=#|]/g, '');

                    return {
                        id: finalId,
                        values: embedding,
                        metadata: {
                            source: file,
                            text: textsToEmbed[index], 
                            ...cleanMetadata(originalItem) 
                        }
                    };
                });

                // --- TEXT FILE PROCESSING ---
            } else if (file.endsWith('.txt')) {
                const fileChunks = chunking(fileData, 1000, 200);
                if (fileChunks.length === 0) continue;

                console.log(`Processing text file "${file}" with ${fileChunks.length} chunks.`);

                const response = await embedMany({
                    model: google.textEmbeddingModel('gemini-embedding-2'),
                    values: fileChunks,
                    maxParallelCalls: 5,
                    providerOptions: {
                        google: {
                            taskType: 'RETRIEVAL_DOCUMENT',
                            outputDimensionality: 1536
                        }
                    }
                });

                vectors = response.embeddings.map((embedding, index) => ({
                    id: `${file.replace(/[^a-zA-Z0-9]/g, '-')}-chunk-${index}`.replace(/[^a-zA-Z0-9\-_:;=#|]/g, ''),
                    values: embedding,
                    metadata: {
                        source: file,
                        text: fileChunks[index]
                    }
                }));
            } else {
                console.log("File type not supported: ", file);
                continue;
            }

            // --- BATCH UPSERT TO PINECONE ---
            if (vectors.length === 0) {
                console.warn(`⚠️ Mapped vectors array is empty for ${file}. Skipping.`);
                continue;
            }

            const pineconeBatchSize = 100;
            for (let i = 0; i < vectors.length; i += pineconeBatchSize) {
                const batch = vectors.slice(i, i + pineconeBatchSize);
                console.log(`Upserting batch of ${batch.length} records to Pinecone...`);
                await indexInstance.upsert({ records: batch });
            }

            console.log(`✅ Successfully saved ${file} to Pinecone.`);
        }
        console.log("All files processed successfully.");
    } catch (err) {
        console.error("Critical Processing Error: ", err);
    }
}

// Custom character-level sliding-window fallback function for text chunks
function chunking(text: string, size: number, overlap: number): string[] {
    const chunks: string[] = [];
    const separators = ["\n\n", "\n", ". ", " ", ""];
    let chunkCount = 1;

    function addChunk(chunkText: string) {
        const trimmed = chunkText.trim();
        if (trimmed) {
            chunks.push(trimmed);
            console.log(`[Chunk ${chunkCount++}] (${trimmed.length} chars) extracted.`);
        }
    }

    function recursiveSplit(currentText: string, separatorIndex: number) {
        currentText = currentText.trim();
        if (!currentText) return;

        if (currentText.length <= size) {
            addChunk(currentText);
            return;
        }

        if (separatorIndex >= separators.length) {
            let start = 0;
            while (start < currentText.length) {
                const end = Math.min(start + size, currentText.length);
                addChunk(currentText.slice(start, end));
                start += (size - overlap) <= 0 ? size : (size - overlap);
            }
            return;
        }

        const separator = separators[separatorIndex];
        const parts = currentText.split(separator);
        let currentChunk = "";

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const potentialChunk = currentChunk
                ? currentChunk + (separator === " " ? " " : separator) + part
                : part;

            if (potentialChunk.length <= size) {
                currentChunk = potentialChunk;
            } else {
                if (currentChunk) {
                    addChunk(currentChunk);

                    let overlapStart = Math.max(0, currentChunk.length - overlap);
                    const actualOverlapIndex = currentChunk.indexOf(separator, overlapStart);

                    const overlapString = actualOverlapIndex !== -1
                        ? currentChunk.slice(actualOverlapIndex + separator.length)
                        : currentChunk.slice(overlapStart);

                    currentChunk = overlapString ? overlapString + separator + part : part;
                } else {
                    recursiveSplit(part, separatorIndex + 1);
                }
            }
        }

        if (currentChunk.trim().length > 0 && currentChunk.length <= size) {
            addChunk(currentChunk);
        }
    }

    console.log(`=== Starting Chunking Process (Size: ${size}, Overlap: ${overlap}) ===`);
    recursiveSplit(text, 0);
    console.log(`=== Chunking Complete. Total Chunks: ${chunks.length} ===\n`);

    return chunks;
}

// Execute the process
embedAndSave();