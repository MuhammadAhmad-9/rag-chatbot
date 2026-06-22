import { createClient } from "redis";

if (!process.env.REDIS_PASSWORD || !process.env.REDIS_HOST) {
    throw new Error('Missing REDIS_URL environment variable');
}

export const redisClient = createClient({
    username: 'default',
    socket: {
        host: process.env.REDIS_HOST,
        port: 18857
    },
    password: process.env.REDIS_PASSWORD,
});

const initIndices = async () => {
    const indexName = 'idx:semantic_cache';
    
    try {
        const existingIndexes = await redisClient.ft._list();
        if (existingIndexes.includes(indexName)) {
            console.log(`Redis Search Index "${indexName}" already exists.`);
            return;
        }

        console.log(`Creating Redis Search Index "${indexName}"...`);
        await redisClient.ft.create(
            indexName,
            {
                'prompt_vector': {
                    type: 'VECTOR',
                    ALGORITHM: 'HNSW',       
                    TYPE: 'FLOAT32',
                    DIM: 1536,              
                    DISTANCE_METRIC: 'COSINE'
                },
                'response': { type: 'TEXT' },
                'prompt': { type: 'TEXT' }
            },
            {
                ON: 'HASH',
                PREFIX: 'cache:' 
            }
        );
        console.log(`Redis Search Index "${indexName}" created successfully!`);
    } catch (error) {
        console.error('Failed to verify or create Redis index:', error);
        throw error;
    }
};

export const initRedis = async () => {
    try {
        await redisClient.connect();
        console.log('Redis connected successfully.');
        
        await initIndices(); 
    } catch (error) {
        console.error('Error connecting to Redis:', error);
        throw error;
    }
};