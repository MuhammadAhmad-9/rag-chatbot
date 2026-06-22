import { google } from "@ai-sdk/google"
import { embed } from "ai"

export const queryEmbedding = async (query: string) => {
    const { embedding } = await embed({
        model: google.textEmbedding('gemini-embedding-2'),
        value: query,
        providerOptions: {
            google: {
                taskType: 'RETRIEVAL_QUERY',
                outputDimensionality: 1536
            }
        }
    })
    return embedding
}