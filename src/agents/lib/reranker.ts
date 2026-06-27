
const rerank = async (query, retrievedDocuments, topK) => {
    const result = await fetch('https://api.cohere.com/v2/rerank', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.COHERE_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            query,
            model: 'rerank-v3.5',
            documents: retrievedDocuments,
            top_n: topK
        })
    })
    return result.json();

}
export const rerankRetrievedDocuments = async (query: string, retrievedDocuments: string, topK: number): Promise<string> => {
    const retrievedDocumentsArray = retrievedDocuments.split('\n\n');
    const rerankResult = await rerank(query, retrievedDocumentsArray, topK);

    if (!rerankResult || !rerankResult.results) {
        return retrievedDocuments
    }

    const sorted = rerankResult.results.sort((a: any, b: any) => b.relevance_score - a.relevance_score);

    const rankedDocumentsString = sorted
        .map((item: any, index: number) => {
            const docContent = retrievedDocumentsArray[item.index];
            return `[Rank ${index + 1}]\n${docContent}`;
        })
        .join('\n\n');

    return rankedDocumentsString;
}