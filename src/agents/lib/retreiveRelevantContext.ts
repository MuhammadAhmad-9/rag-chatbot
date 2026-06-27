import { initPineconeIndex } from "../config/pinecone.config"

export const retreiveRelevantContext = async (queryEmbedding: number[], topK: number) => {
    const index = await initPineconeIndex()
    const topKContext = await index.query({
        topK,
        vector: queryEmbedding,
        includeMetadata: true
    })
    const contextString = topKContext?.matches?.map((match: any) => {
        const text = match.metadata?.text
        return `${text}`
    }).join('\n\n')

    return contextString
}
