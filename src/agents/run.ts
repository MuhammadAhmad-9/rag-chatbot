import { streamText, generateText, generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { systemPrompts } from './prompts';
import { filterMessages } from './lib/filterMessages';
import { queryEmbedding } from './lib/queryEmbedding';
import { retreiveRelevantContext } from './lib/retreiveRelevantContext';
import { redisClient, initRedis } from './config/redis.config';
import { rerankRetrievedDocuments } from './lib/reranker';
import { z } from 'zod';
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
    let queryVectors: number[] = [];
    let optimizedQuery = message;

    try {
        const { isGreetingOrCasual, optimizedQuery: optQ, directResponse } = await queryOptimizer(message);
        optimizedQuery = optQ;

        if (isGreetingOrCasual) {
            return {
                toTextStreamResponse: () => {
                    return new Response(directResponse, {
                        headers: {
                            'Content-Type': 'text/plain; charset=utf-8'
                        }
                    });
                }
            } as any;
        }


        queryVectors = await queryEmbedding(optimizedQuery);

    } catch (preProcessingError) {
        console.error('Critical pre-processing or embedding failed:', preProcessingError);
        throw preProcessingError;
    }

    try {
        await ensureRedis();
        const buffer = Buffer.from(new Float32Array(queryVectors).buffer);
        const searchResults = await redisClient.ft.search(
            'idx:semantic_cache',
            '*=>[KNN 1 @prompt_vector $vector_blob AS vector_score]',
            {
                PARAMS: { vector_blob: buffer },
                DIALECT: 2,
                RETURN: ['prompt', 'response', 'vector_score']
            }
        );

        if (searchResults.total > 0 && searchResults.documents.length > 0) {
            const doc = searchResults.documents[0];
            const score = parseFloat(doc.value.vector_score as string);
            const cachedPrompt = doc.value.prompt as string;

            if (score < 0.05 || cachedPrompt.trim().toLowerCase() === optimizedQuery.trim().toLowerCase()) {
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
        console.error('Redis cache lookup failed, proceeding to LLM generation:', cacheError);
    }

    try {
        const context = await retreiveRelevantContext(queryVectors, 10);
        const reRankedContext = await rerankRetrievedDocuments(message, context, 5);

        const augmentedSystemPrompt = `
        ${systemPrompts}
The following context documents have been reranked based on relevance to the user's query. Use the '[Rank X]' prefixes to prioritize your information retrieval, where Rank 1 is the most relevant.
${reRankedContext}
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
                if (decision.includes('YES') && queryVectors.length > 0) {
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

    } catch (generationError) {
        console.error('Context retrieval or text generation failed:', generationError);
        throw generationError;
    }
};

export const queryOptimizer = async (userQuery: string) => {
    const result = await generateObject({
        model: google(MODEL),
        schema: z.object({
            isGreetingOrCasual: z.boolean().describe(
                "Set to true if the query is a greeting, goodbye, or casual chat (e.g., 'hi', 'hello', 'how are you'). Set to false if the user is looking for or asking about products."
            ),
            optimizedQuery: z.string().describe(
                "The optimized search query rewritten for the product dataset. If isGreetingOrCasual is true, this can be empty."
            ),
            directResponse: z.string().optional().describe(
                "If isGreetingOrCasual is true, provide a friendly, helpful greeting response (e.g., 'Hello! How can I help you find a product today?'). If false, leave this empty."
            ),
        }),
        prompt: `You are a query optimizer for an e-commerce product search engine. 
        The dataset contains information about products, including their names, descriptions, categories, prices, and stock status.
        
        Analyze the following user query:
        User query: "${userQuery}"
        
        Determine if it is a casual greeting or a product-focused search, and populate the schema accordingly.`,
    });

    return result.object;
}