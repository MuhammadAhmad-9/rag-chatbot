import { streamText, generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { systemPrompts } from './prompts';
import { filterMessages } from './lib/filterMessages';
import { queryEmbedding } from './lib/queryEmbedding';
import { retreiveRelevantContext } from './lib/retreiveRelevantContext';
import { redisClient, initRedis } from './config/redis.config';
const MODEL = 'gemini-3.1-flash-lite';

let isInitializing: Promise<void> | null = null;

const ensureRedis = async () => {
    if (redisClient.isOpen) return;
    if (!isInitializing) {
        isInitializing = initRedis().catch((err) => {
            isInitializing = null;
            throw err;
        });
    }
    await isInitializing;
};

export const runAgent = async (history: any, message: string) => {
    console.log('Generating embedding for user message...');
    const queryVectors = await queryEmbedding(message);

    try {
        await ensureRedis();
        const buffer = Buffer.from(new Float32Array(queryVectors).buffer);
        const searchResults = await redisClient.ft.search(
            'idx:semantic_cache',
            '*=>[KNN 1 @prompt_vector $vector_blob AS vector_score]',
            {
                PARAMS: {
                    vector_blob: buffer
                },
                DIALECT: 2,
                RETURN: ['prompt', 'response', 'vector_score']
            }
        );

        if (searchResults.total > 0 && searchResults.documents.length > 0) {
            const doc = searchResults.documents[0];
            const score = parseFloat(doc.value.vector_score as string);
            const cachedPrompt = doc.value.prompt as string;

            if (score < 0.05 || cachedPrompt.trim().toLowerCase() === message.trim().toLowerCase()) {
                console.log(`Cache hit! Score: ${score}, Match prompt: "${cachedPrompt}"`);
                const cachedResponse = doc.value.response as string;
                return {
                    toTextStreamResponse: () => {
                        return new Response(cachedResponse, {
                            headers: {
                                'Content-Type': 'text/plain; charset=utf-8'
                            }
                        });
                    }
                } as any;
            }
        }
    } catch (cacheError) {
        console.error('Redis cache lookup failed:', cacheError);
    }

    console.log('Retrieving relevant chunks...');
    const context = await retreiveRelevantContext(queryVectors, 10);
    const augmentedSystemPrompt = `
    ${systemPrompts}
You have access to the following context retrieved from the dataset:
${context}
    `;

    const messages = [
        ...filterMessages(history),
        {
            role: 'user',
            content: message,
        }
    ];
    const result = streamText({
        model: google(MODEL),
        system: augmentedSystemPrompt,
        messages,
    });

    (async () => {
        try {
            const text = await result.text;

            const decisionResult = await generateText({
                model: google(MODEL),
                prompt: `You are a cache administrator. Decide if the following interaction between a user and an AI assistant should be cached in a semantic cache for future similar queries.

Guidelines:
- General queries, facts, code explanations, structured help, static definitions, or knowledge lookup SHOULD be cached (YES).
- Greeting/conversational filler (e.g. "hi", "how are you"), time-sensitive queries (e.g. "what time is it", weather), highly dynamic, or user/session-specific data should NOT be cached (NO).

User query: "${message}"
Assistant response: "${text}"

Respond with exactly "YES" or "NO". Only respond with one of these two words.`,
            });

            const decision = decisionResult.text.trim().toUpperCase();
            if (decision.includes('YES')) {
                await ensureRedis();
                const id = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                const cacheKey = `cache:${id}`;
                const floatArray = new Float32Array(queryVectors);
                const vectorBuffer = Buffer.from(floatArray.buffer);

                await redisClient.hSet(cacheKey, {
                    prompt_vector: vectorBuffer,
                    prompt: message,
                    response: text
                });
            }
        } catch (err) {
            console.error('Stream text error during cache write:', err);
        }
    })();

    return result;
};