import app from './index.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    try {
        await app.initializeChroma();
        console.log('RAG system initialized and ready for queries');
    } catch (error) {
        console.error('Failed to initialize RAG system:', error);
    }
});
