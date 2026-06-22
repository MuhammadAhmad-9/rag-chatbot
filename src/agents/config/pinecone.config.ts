import { Pinecone } from '@pinecone-database/pinecone';

if (!process.env.PINECONE_API_KEY) {
    throw new Error('Missing PINECONE_API_KEY environment variable');
}

const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
});

const INDEX_NAME = 'rag-dotproduct-hybrid-search'; 

export const initPineconeIndex = async () => {
    try {
        const response = await pinecone.listIndexes();
        const indexExists = response.indexes?.some(idx => idx.name === INDEX_NAME);

        if (!indexExists) {
            console.log(`Creating index: ${INDEX_NAME}...`);
            await pinecone.createIndex({
                name: INDEX_NAME,
                dimension: 1536,
                metric: 'dotproduct',
                spec: {
                    serverless: {
                        cloud: 'aws',
                        region: 'us-east-1',
                    },
                },
            });
            console.log(`Index ${INDEX_NAME} created successfully.`);
            await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
            console.log(`Index ${INDEX_NAME} already exists.`);
        }

        // ✨ FIX: Move this OUTSIDE the if/else block so it always runs
        return pinecone.index(INDEX_NAME);

    } catch (error) {
        console.error('Error configuring Pinecone index:', error);
        throw error;
    }
};