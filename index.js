// import "dotenv/config";
// import dotenv from "dotenv";
// dotenv.config();

// import 'dotenv/config';
import dotenv from "dotenv";
dotenv.config();
//

import express from 'express';
import { ChromaClient } from 'chromadb';
import { ChatOpenAI } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { detect } from 'langdetect';
import cors from 'cors';
import winston from 'winston';
import crypto from 'crypto';
import cron from 'node-cron';
import DailyRotateFile from 'winston-daily-rotate-file';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
    origin: 'https://visachat.bluedawn.kr',
    methods: ['GET', 'POST']
}));

const llm = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: 'gpt-4o-mini',
    temperature: 0
});

// 향상된 임베딩 전처리 함수
function enhancedPreprocessForEmbedding(text) {
    // 기본 타입 검사
    if (typeof text !== 'string') {
        return String(text);
    }

    // 1. 숫자 정보 태깅 (확장된 패턴)
    text = text.replace(/(\d+(?:,\d+)*(?:\.\d+)?)/g, '<num>$1</num>');

    // 2. 날짜 정보 태깅 (여러 형식 지원)
    text = text.replace(/(\d{4}[\.\/\-]?\d{1,2}[\.\/\-]?\d{1,2})/g, '<date>$1</date>');

    // 3. 기간 태깅
    text = text.replace(/(\d+)\s*(일|개월|년|weeks|months|years|日|週間|ヶ月|年)/gi, '<duration>$1$2</duration>');

    // 4. 법률 및 문서 참조 태깅
    text = text.replace(/([제]?\s*\d+\s*[조항호목])/g, '<legal>$1</legal>');
    text = text.replace(/(법률\s*제\s*\d+\s*호)/g, '<legal>$1</legal>');

    // 5. 비자 유형 태깅
    text = text.replace(/([\w\d\-]+\s*비자|[\w\d\-]+\s*visa|在留資格)/gi, '<visa>$1</visa>');

    // 6. 기관명 태깅
    text = text.replace(/(출입국( 외국인)? (관리|사무)소|법무부|외교부)/g, '<org>$1</org>');

    // 7. 불필요한 공백 및 특수문자 정리
    text = text.replace(/\s+/g, ' ').trim();

    return text;
}

const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY
});

const embeddingFunction = {
    generate: async (texts) => {
        // 각 텍스트에 향상된 전처리 적용
        const preprocessedTexts = texts.map(text => enhancedPreprocessForEmbedding(text));

        // 훨씬 더 보수적인 토큰 제한 설정
        const MAX_TOKENS = 4000; // 4000 토큰으로 제한 (절반으로 줄임)

        // 매우 보수적인 문자-토큰 비율 사용 (2글자당 1토큰으로 계산)
        const filteredTexts = preprocessedTexts.map((text, index) => {
            if (text.length > MAX_TOKENS * 2) {
                console.warn(`Text #${index} length exceeds token limit, truncating from ${text.length} chars to ${MAX_TOKENS * 2}`);
                return text.substring(0, MAX_TOKENS * 2);
            }
            return text;
        });

        // 배치 크기를 더 작게 (5개로 줄임)
        const batchSize = 5;
        let allEmbeddings = [];

        for (let i = 0; i < filteredTexts.length; i += batchSize) {
            const batch = filteredTexts.slice(i, i + batchSize);
            console.log(`Processing embedding batch ${Math.floor(i / batchSize) + 1}, size: ${batch.length}`);

            try {
                const batchEmbeddings = await embeddings.embedDocuments(batch);
                allEmbeddings = [...allEmbeddings, ...batchEmbeddings];
            } catch (error) {
                console.error(`Error in batch ${Math.floor(i / batchSize) + 1}:`, error.message);

                // 오류 발생 시 개별 처리 시도
                console.log("Attempting individual processing for this batch...");
                for (let j = 0; j < batch.length; j++) {
                    try {
                        // 텍스트를 더 과감하게 자르기
                        let text = batch[j];
                        if (text.length > 3000) {
                            console.warn(`Further truncating text from ${text.length} to 3000 chars`);
                            text = text.substring(0, 3000);
                        }

                        const singleEmbedding = await embeddings.embedDocuments([text]);
                        allEmbeddings.push(singleEmbedding[0]);
                    } catch (innerError) {
                        console.error(`Cannot process item ${j} in problematic batch: ${innerError.message}`);
                        // 임시 임베딩 생성 (0으로 채운 벡터)
                        allEmbeddings.push(new Array(1536).fill(0));
                    }
                }
            }
        }

        return allEmbeddings;
    }
};

const errorTransport = new DailyRotateFile({
    filename: 'logs/error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d',
    level: 'error'
});

const searchTransport = new DailyRotateFile({
    filename: 'logs/search-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d',
    level: 'info'
});

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        errorTransport,
        searchTransport,
        new winston.transports.Console()
    ]
});

// 파일 해시 관리 함수
async function getFileHash(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    return crypto.createHash('md5').update(content).digest('hex');
}

async function getStoredHash() {
    try {
        const hashFile = path.join(__dirname, '.rag-hash');
        const hash = await fs.readFile(hashFile, 'utf8');
        return hash.trim();
    } catch (error) {
        return '';
    }
}

async function storeNewHash(hash) {
    const hashFile = path.join(__dirname, '.rag-hash');
    await fs.writeFile(hashFile, hash);
}

let collection = null;
let client = null;

// 의미 기반 청킹 함수
function semanticSplitIntoChunks(text) {
    // 1단계: 제목과 섹션으로 분할
    const sections = text.split(/(?=##\s|###\s)/);

    // 임시 청크 저장
    const tempChunks = [];

    // 2단계: 각 섹션을 하위 섹션으로 분할하되, 의미 단위 고려
    for (const section of sections) {
        const title = extractTitle(section);
        const category = extractCategory(section);

        // 의미 단위로 분할 (예: 번호 매긴 항목, 문단 등)
        const subSections = section.split(/(?=\n\d+\.\s|\n\n)/);

        for (const sub of subSections) {
            // 너무 짧은 섹션은 건너뛰거나 결합
            if (sub.trim().length < 50) continue;

            tempChunks.push({
                content: sub.trim(),
                metadata: {
                    title,
                    category,
                    subSectionType: detectSubSectionType(sub)
                }
            });
        }
    }

    // 3단계: 청크 최적화 - 너무 작은 청크는 합치고 너무 큰 청크는 분할
    const finalChunks = [];
    let currentChunk = null;

    for (const chunk of tempChunks) {
        if (!currentChunk) {
            currentChunk = { ...chunk };
            continue;
        }

        // 같은 주제라면 결합 시도 - 최대 크기를 800으로 줄임(기존 1200)
        if (currentChunk.metadata.title === chunk.metadata.title) {
            // 결합 시 최대 크기 확인 - 토큰 제한 고려
            if ((currentChunk.content.length + chunk.content.length) < 800) {
                currentChunk.content += "\n\n" + chunk.content;
                continue;
            }
        }

        // 결합할 수 없으면 현재 청크 저장하고 새 청크 시작
        finalChunks.push(currentChunk);
        currentChunk = { ...chunk };
    }

    // 마지막 청크 추가
    if (currentChunk) {
        finalChunks.push(currentChunk);
    }

    // 4단계: 오버래핑 청크 생성 - 간소화된 버전 사용
    const limitedOverlapChunks = createSimplifiedOverlappingChunks(finalChunks);

    return [...finalChunks, ...limitedOverlapChunks];
}

// 간소화된 오버래핑 청크 생성 함수
function createSimplifiedOverlappingChunks(chunks) {
    const overlaps = [];

    // 연속된 2개의 청크만 결합 (기존 3개에서 축소)
    for (let i = 0; i < chunks.length - 1; i++) {
        // 동일한 카테고리/제목의 연속 청크만 결합
        if (chunks[i].metadata.category === chunks[i + 1].metadata.category) {
            // 결합된 콘텐츠 길이 체크 - 임베딩 토큰 제한 고려
            const combinedContent = chunks[i].content + "\n\n" + chunks[i + 1].content;

            // 대략적으로 4글자당 1토큰으로 계산하여 6000자 이하로 제한
            if (combinedContent.length <= 6000) {
                overlaps.push({
                    content: combinedContent,
                    metadata: {
                        title: chunks[i].metadata.title,
                        category: chunks[i].metadata.category,
                        subSectionType: 'combined_section',
                        isOverlap: true
                    }
                });
            }
        }
    }

    return overlaps;
}

function detectSubSectionType(text) {
    if (/^\d+\.\s/.test(text)) return 'numbered_item';
    if (/^[가-힣]\.\s/.test(text)) return 'korean_item';
    if (/^\([가-힣]\)/.test(text)) return 'parenthesized_item';
    if (/^\s*-\s+/.test(text)) return 'bullet_item';
    return 'paragraph';
}

function createOverlappingChunks(chunks) {
    const overlaps = [];

    // 연속된 3개의 청크를 하나로 결합하여 더 넓은 컨텍스트 생성
    for (let i = 0; i < chunks.length - 2; i++) {
        // 동일한 카테고리/제목의 연속 청크만 결합
        if (chunks[i].metadata.category === chunks[i + 1].metadata.category &&
            chunks[i + 1].metadata.category === chunks[i + 2].metadata.category) {

            overlaps.push({
                content:
                    chunks[i].content + "\n\n" +
                    chunks[i + 1].content + "\n\n" +
                    chunks[i + 2].content,
                metadata: {
                    title: chunks[i].metadata.title,
                    category: chunks[i].metadata.category,
                    subSectionType: 'combined_section',
                    isOverlap: true
                }
            });
        }
    }

    return overlaps;
}

async function updateVectorDB() {
    try {
        logger.info('Starting vector DB update...');

        // [1] client 초기화 (client가 없을 경우 새로 생성)
        if (!client) {
            client = new ChromaClient({ path: "http://127.0.0.1:8000" });
            logger.info('Client was not initialized. New client created.');
        }

        // [2] 기존 컬렉션 삭제 시도
        try {
            const collections = await client.listCollections();
            for (let col of collections) {
                if (col === "visa_info") {
                    await client.deleteCollection({ name: "visa_info" });
                    logger.info('Existing collection deletion initiated');
                    break;
                }
            }
        } catch (error) {
            logger.error('Error checking/deleting existing collections:', error);
        }

        // [3] 삭제 완료 여부 확인 (최대 5초 정도 대기)
        let retries = 10;
        let collectionsAfterDelete = await client.listCollections();
        while (retries > 0 && collectionsAfterDelete.includes("visa_info")) {
            logger.info('Waiting for collection deletion...');
            await new Promise(resolve => setTimeout(resolve, 500));
            collectionsAfterDelete = await client.listCollections();
            retries--;
        }

        // [4] 만약 여전히 컬렉션이 존재하면 -> 강제로 기존 컬렉션 클리어 시도
        if (collectionsAfterDelete.includes("visa_info")) {
            logger.warn("Existing collection still present. Attempting to clear its documents...");
            try {
                collection = await client.getCollection({ name: "visa_info", embeddingFunction });
                if (typeof collection.deleteAllDocuments === 'function') {
                    await collection.deleteAllDocuments();
                    logger.info("Existing collection documents cleared via deleteAllDocuments().");
                } else {
                    const queryResult = await collection.query({ queryTexts: [""], nResults: 10000 });
                    const docIds = queryResult.ids[0];
                    if (docIds && docIds.length > 0) {
                        await collection.delete({ ids: docIds });
                        logger.info("Existing collection documents cleared via fallback deletion.");
                    } else {
                        logger.info("No documents found to delete in the existing collection.");
                    }
                }
            } catch (clearError) {
                logger.error("Failed to clear existing collection documents:", clearError);
                throw new Error("Failed to update vector DB because existing collection could not be cleared.");
            }
        } else {
            // [5] 기존 컬렉션이 삭제되었으면 새 컬렉션 생성
            collection = await client.createCollection({
                name: "visa_info",
                embeddingFunction
            });
            logger.info('New collection created successfully');
        }

        // [6] 파일 읽기 및 청크 분할 - 의미 기반 청킹 사용
        const filePath = path.join(__dirname, 'documents', 'RAG_Immigration.md');
        const content = await fs.readFile(filePath, 'utf8');
        const chunks = semanticSplitIntoChunks(content);

        const documents = chunks.map((chunk, index) => ({
            pageContent: chunk.content,
            metadata: {
                source: 'RAG_Immigration.md',
                chunk: index,
                title: chunk.metadata.title,
                category: chunk.metadata.category,
                subSectionType: chunk.metadata.subSectionType,
                isOverlap: chunk.metadata.isOverlap || false
            }
        }));

        // [7] 새 문서 추가
        await collection.add({
            ids: documents.map((_, i) => `doc_${i}`),
            documents: documents.map(doc => doc.pageContent),
            metadatas: documents.map(doc => doc.metadata)
        });

        logger.info('Vector DB update completed successfully');
    } catch (error) {
        logger.error('Error updating vector DB:', error);
        throw error;
    }
}

async function initializeChroma() {
    try {
        console.log('Starting ChromaDB initialization...');
        client = new ChromaClient({
            path: "http://127.0.0.1:8000"
        });

        // 먼저 vectordb_data.json 파일 확인
        const vectorDbPath = path.join(__dirname, 'vectordb_data.json');
        let vectorData = null;

        try {
            const fileContent = await fs.readFile(vectorDbPath, 'utf8');
            vectorData = JSON.parse(fileContent);
            console.log(`Loaded ${vectorData.totalChunks} chunks from vectordb_data.json`);
        } catch (error) {
            console.warn('vectordb_data.json not found, falling back to legacy mode');
        }

        // 기존 컬렉션 확인
        let collectionExists = false;
        try {
            const collections = await client.listCollections();
            collectionExists = collections.includes("visa_info");
        } catch (error) {
            console.warn('Could not list collections:', error.message);
        }

        // vectordb_data.json이 있으면 새로 로드
        if (vectorData && vectorData.documents && vectorData.documents.length > 0) {
            console.log('Loading pre-computed embeddings from vectordb_data.json...');

            // 기존 컬렉션 삭제
            if (collectionExists) {
                try {
                    await client.deleteCollection({ name: "visa_info" });
                    console.log('Deleted existing collection');
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (error) {
                    console.warn('Could not delete existing collection:', error.message);
                }
            }

            // 커스텀 임베딩 함수 - 이미 계산된 임베딩 사용
            const precomputedEmbeddings = new Map();
            vectorData.documents.forEach(doc => {
                precomputedEmbeddings.set(doc.id, doc.embedding);
            });

            // 새 컬렉션 생성 (임베딩 없이)
            collection = await client.createCollection({
                name: "visa_info"
            });
            console.log('Created new collection');

            // 문서와 임베딩 추가
            const batchSize = 50;
            for (let i = 0; i < vectorData.documents.length; i += batchSize) {
                const batch = vectorData.documents.slice(i, i + batchSize);
                console.log(`Adding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(vectorData.documents.length / batchSize)}`);

                await collection.add({
                    ids: batch.map(d => d.id),
                    documents: batch.map(d => d.content),
                    metadatas: batch.map(d => d.metadata),
                    embeddings: batch.map(d => d.embedding)
                });
            }

            console.log(`Successfully loaded ${vectorData.documents.length} documents with embeddings`);
        } else {
            // 레거시 모드: 기존 컬렉션 사용
            if (collectionExists) {
                console.log('Using existing ChromaDB collection (legacy mode)');
                collection = await client.getCollection({
                    name: "visa_info",
                    embeddingFunction
                });
            } else {
                console.warn('No vectordb_data.json and no existing collection. RAG will not work properly.');
                // 빈 컬렉션 생성
                collection = await client.createCollection({
                    name: "visa_info",
                    embeddingFunction
                });
            }
        }

        return collection;
    } catch (error) {
        console.error('Error in initializeChroma:', error);
        throw error;
    }
}

function extractTitle(section) {
    const titleMatch = section.match(/^#{2,3}\s+(.+)$/m);
    return titleMatch ? titleMatch[1].trim() : '';
}

function extractCategory(section) {
    const categoryMatch = section.match(/^#{2}\s+(.+)$/m);
    return categoryMatch ? categoryMatch[1].trim() : '';
}

// 쿼리 확장 함수
async function enhanceQuery(question, detectedLang) {
    const queryEnhancementPrompt = `
    As a query enhancement assistant, please analyze this immigration/visa question and:
    1. Identify the main intent (procedure, eligibility, timeline, requirements, etc.)
    2. Extract key entities (visa types, durations, statuses, etc.)
    3. Rewrite the question in a more comprehensive way
    4. Add synonyms for key terms
    5. Generate 2-3 alternative formulations of the same question
    
    Original question: ${question}
    
    Return in JSON format:
    {
      "intent": "string",
      "entities": ["string"],
      "enhancedQuery": "string",
      "alternativeQueries": ["string"]
    }
  `;

    const enhancer = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: 'gpt-4o-mini',
        temperature: 0.2
    });

    try {
        const enhancementResult = await enhancer.invoke(queryEnhancementPrompt);
        const enhancement = JSON.parse(enhancementResult.content);

        return {
            originalQuery: question,
            enhancedQuery: enhancement.enhancedQuery,
            alternativeQueries: enhancement.alternativeQueries,
            intent: enhancement.intent,
            entities: enhancement.entities,
            detectedLang
        };
    } catch (error) {
        logger.warn('Query enhancement failed, using original query', error);
        return {
            originalQuery: question,
            enhancedQuery: question,
            alternativeQueries: [],
            intent: null,
            entities: [],
            detectedLang
        };
    }
}

// 키워드 검색 함수
function extractLegalTerms(text) {
    const legalTerms = [
        '체류자격', '비자', '외국인등록', '체류기간', '연장허가', '자격변경',
        '재입국', '허가', '신청', '심사', '면제', '취소', '격리', '제한',
        '출입국', '체류지', '신고', '등록증', '발급', '신원보증',
        '체류', '거주', '거주자', '단기', '장기', '취업', '유학', '관광',
        '여행', '방문', '무비자', '특별체류', '동반', '초청', '국민', '국적',
        '영주권', '초과체류', '불법체류', '연장', '자격', '합법', '유효',
        '증명서', '필수', '보증인', '여권', '사증', '책임', '법령'
    ];

    return legalTerms.filter(term => text.includes(term));
}

// 다단계 검색 전략 구현
async function multiStageRetrieval(queryData, collection) {
    const initialQueries = [queryData.enhancedQuery];

    if (queryData.alternativeQueries && queryData.alternativeQueries.length > 0) {
        initialQueries.push(...queryData.alternativeQueries.slice(0, 2));
    }

    const results = [];

    for (const query of initialQueries) {
        try {
            const result = await collection.query({
                queryTexts: [query],
                nResults: 15,
                mmr: true,
                mmrDiversity: 0.3
            });

            const docs = result.documents[0].map((doc, i) => ({
                content: doc,
                metadata: result.metadatas[0][i],
                score: result.distances[0][i],
                querySource: query === queryData.enhancedQuery ? 'enhanced' : 'alternative'
            }));

            results.push(...docs);
        } catch (error) {
            logger.error(`Error in vector search for query: ${query}`, error);
        }
    }

    const uniqueDocs = [];
    const seenIds = new Set();

    results.forEach(doc => {
        const docId = doc.metadata.chunk;

        if (!seenIds.has(docId)) {
            seenIds.add(docId);
            uniqueDocs.push(doc);
        }
    });

    const enhancedDocs = uniqueDocs.map(doc => {
        const keywordScore = calculateEnhancedKeywordScore(doc.content, queryData);
        const metadataScore = calculateMetadataRelevance(doc.metadata, queryData);
        const sourceWeight = doc.querySource === 'enhanced' ? 1.0 : 0.8;

        return {
            ...doc,
            keywordScore,
            metadataScore,
            finalScore: ((doc.score * 0.5) + (keywordScore * 0.3) + (metadataScore * 0.2)) * sourceWeight
        };
    });

    return enhancedDocs
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, 5);
}

// 향상된 키워드 점수 계산
function calculateEnhancedKeywordScore(docContent, queryData) {
    let score = 0;

    if (queryData.entities && queryData.entities.length > 0) {
        queryData.entities.forEach(entity => {
            const regex = new RegExp(`\\b${entity}\\b`, 'i');
            if (regex.test(docContent)) {
                score += 2;
            }
        });
    }

    const numbers = extractNumbers(docContent);
    const numbersInQuery = extractNumbers(queryData.originalQuery);

    if (numbersInQuery.dates && numbers.dates) {
        numbersInQuery.dates.forEach(date => {
            if (numbers.dates.includes(date)) score += 3;
        });
    }

    if (numbersInQuery.durations && numbers.durations) {
        numbersInQuery.durations.forEach(duration => {
            if (numbers.durations.includes(duration)) score += 3;
        });
    }

    const legalTermsInDoc = extractLegalTerms(docContent);
    const legalTermsInQuery = extractLegalTerms(queryData.originalQuery);

    legalTermsInQuery.forEach(term => {
        if (legalTermsInDoc.includes(term)) score += 2;
    });

    if (queryData.intent) {
        const intentKeywords = getIntentKeywords(queryData.intent, queryData.detectedLang);
        intentKeywords.forEach(keyword => {
            if (docContent.includes(keyword)) score += 1;
        });
    }

    return score;
}

// 의도에 따른 키워드 목록 반환
function getIntentKeywords(intent, lang) {
    const intentKeywords = {
        'eligibility': {
            'ko': ['자격', '조건', '요건', '대상', '해당'],
            'en': ['eligible', 'qualify', 'requirement', 'criteria'],
            'ja': ['資格', '条件', '要件', '対象'],
            'zh': ['资格', '条件', '要求', '对象'],
            'vi': ['điều kiện', 'yêu cầu', 'tiêu chí']
        },
        'procedure': {
            'ko': ['절차', '방법', '과정', '신청', '제출'],
            'en': ['procedure', 'process', 'apply', 'submit', 'how to'],
            'ja': ['手続き', '方法', '過程', '申請', '提出'],
            'zh': ['程序', '方法', '过程', '申请', '提交'],
            'vi': ['thủ tục', 'quy trình', 'cách thức', 'nộp đơn']
        },
        'timeline': {
            'ko': ['기간', '날짜', '언제', '시간', '만료'],
            'en': ['deadline', 'timeline', 'when', 'expiry', 'duration'],
            'ja': ['期間', '日付', 'いつ', '時間', '満了'],
            'zh': ['期限', '日期', '何时', '时间', '到期'],
            'vi': ['thời hạn', 'ngày', 'khi nào', 'thời gian']
        },
        'requirements': {
            'ko': ['필요', '필수', '구비', '요구', '서류'],
            'en': ['required', 'document', 'needed', 'necessary', 'must'],
            'ja': ['必要', '必須', '書類', '要求'],
            'zh': ['需要', '必要', '文件', '要求'],
            'vi': ['cần thiết', 'tài liệu', 'giấy tờ', 'yêu cầu']
        }
    };

    return intentKeywords[intent]?.[lang] || intentKeywords[intent]?.['en'] || [];
}

// 메타데이터 관련성 점수 계산
function calculateMetadataRelevance(metadata, queryData) {
    let score = 0;

    if (queryData.intent && metadata.category) {
        const categoryToIntentMap = {
            '체류자격': ['eligibility', 'qualification', 'status'],
            '비자신청': ['application', 'procedure', 'requirements'],
            '기간연장': ['extension', 'timeline', 'duration'],
            '외국인등록': ['registration', 'procedure', 'requirements'],
            '취업허가': ['work', 'employment', 'requirements'],
            '학생비자': ['student', 'education', 'requirements'],
            '가족초청': ['family', 'invitation', 'requirements']
        };

        const relatedIntents = categoryToIntentMap[metadata.category] || [];
        if (relatedIntents.includes(queryData.intent)) {
            score += 3;
        }
    }

    if (metadata.title && queryData.entities) {
        queryData.entities.forEach(entity => {
            if (metadata.title.includes(entity)) {
                score += 2;
            }
        });
    }

    if (metadata.isOverlap) {
        if (score < 3) {
            score *= 0.8;
        }
    }

    return score;
}

// 컨텍스트 조립 함수
function assembleEnhancedContext(retrievedDocs, queryData, conversationHistory) {
    const docsByCategory = {};
    retrievedDocs.forEach(doc => {
        const category = doc.metadata.category || 'general';
        if (!docsByCategory[category]) {
            docsByCategory[category] = [];
        }
        docsByCategory[category].push(doc);
    });

    let context = "";

    let primaryCategory = '';
    let highestScore = -1;

    for (const [category, docs] of Object.entries(docsByCategory)) {
        const categoryAvgScore = docs.reduce((sum, doc) => sum + doc.finalScore, 0) / docs.length;
        if (categoryAvgScore > highestScore) {
            highestScore = categoryAvgScore;
            primaryCategory = category;
        }
    }

    if (primaryCategory && docsByCategory[primaryCategory]) {
        context += `## Primary Information (${primaryCategory}):\n\n`;
        docsByCategory[primaryCategory].forEach(doc => {
            context += `${doc.content}\n\n`;
        });
    }

    for (const [category, docs] of Object.entries(docsByCategory)) {
        if (category !== primaryCategory) {
            context += `## Additional Information (${category}):\n\n`;
            docs.forEach(doc => {
                context += `${doc.content}\n\n`;
            });
        }
    }

    if (conversationHistory) {
        const formattedHistory = formatConversationHistory(conversationHistory);
        context = `${formattedHistory}\n\nRelevant background information:\n${context}`;
    }

    if (queryData.intent || (queryData.entities && queryData.entities.length > 0)) {
        let queryMetadata = "Query Analysis:\n";
        if (queryData.intent) {
            queryMetadata += `- Intent: ${queryData.intent}\n`;
        }
        if (queryData.entities && queryData.entities.length > 0) {
            queryMetadata += `- Key entities: ${queryData.entities.join(', ')}\n`;
        }

        context = `${queryMetadata}\n${context}`;
    }

    return context;
}

// 검증 관련 유틸리티 함수들
function extractNumbers(text) {
    const numbers = {
        dates: text.match(/(\d{4}\.?\d{2}\.?\d{2})/g) || [],
        durations: text.match(/(\d+)\s*(일|개월|년)/g) || [],
        amounts: text.match(/(\d+(?:,\d+)*(?:\.\d+)?)\s*(원|달러|USD)/g) || [],
        general: text.match(/\b(\d+(?:,\d+)*(?:\.\d+)?)\b/g) || []
    };
    return numbers;
}

function calculateKeywordMatchScore(doc, keywords) {
    let score = 0;

    keywords.numbers.forEach(num => {
        if (doc.includes(num)) score += 3;
    });

    keywords.dates.forEach(date => {
        if (doc.includes(date)) score += 3;
    });

    keywords.legalTerms.forEach(term => {
        if (doc.includes(term)) score += 2;
    });

    return score;
}

async function validateResponse(answer, context, question, detectedLang) {
    try {
        const numbersInContext = extractNumbers(context);
        const numbersInAnswer = extractNumbers(answer);
        const numbersInQuestion = extractNumbers(question);

        const validationPrompt = `
      As a fact-checking assistant, verify the numerical information in this response about Korean immigration law.
      
      Original context:
      ${context}
      
      Question asked:
      ${question}
      
      Response to verify:
      ${answer}
      
      Numbers found in context:
      ${JSON.stringify(numbersInContext, null, 2)}
      
      Numbers found in response:
      ${JSON.stringify(numbersInAnswer, null, 2)}
      
      Please verify:
      1. Are all numbers in the response present in or derivable from the context?
      2. Are there any numerical inconsistencies?
      3. Are date ranges and durations calculated correctly?
      
      If you find any inconsistencies, provide the correct information based strictly on the context.
      Return your response in JSON format:
      {
        "isValid": boolean,
        "inconsistencies": [
          {
            "type": "date|duration|amount|general",
            "found": "value found in response",
            "correct": "correct value from context",
            "explanation": "explanation of the issue"
          }
        ],
        "suggestedCorrection": "full corrected response if needed, or null if no correction needed"
      }
    `;

        const validator = new ChatOpenAI({
            openAIApiKey: process.env.OPENAI_API_KEY,
            modelName: 'gpt-4o-mini',
            temperature: 0
        });

        const validationResult = await validator.invoke(validationPrompt);
        const parsedResult = JSON.parse(validationResult.content);

        if (!parsedResult.isValid) {
            logger.warn('Validation failed, inconsistencies found:', parsedResult.inconsistencies);
            return parsedResult.suggestedCorrection || answer;
        }

        return answer;

    } catch (error) {
        logger.error('Error in response validation:', error);
        return answer;
    }
}

// 향상된 RAG 응답 생성 함수
async function generateEnhancedRAGResponse(question, conversationHistory) {
    try {
        const langResult = detect(question);
        const detectedLang = Array.isArray(langResult) ? langResult[0].lang : 'en';

        const queryData = await enhanceQuery(question, detectedLang);
        const retrievedDocs = await multiStageRetrieval(queryData, collection);
        const enhancedContext = assembleEnhancedContext(retrievedDocs, queryData, conversationHistory);

        const promptTemplate = getPromptTemplate(detectedLang);
        const chain = promptTemplate
            .pipe(llm)
            .pipe(new StringOutputParser());

        let answer = await chain.invoke({
            context: enhancedContext,
            question: question
        });

        answer = await validateResponse(answer, enhancedContext, question, detectedLang);

        return answer;
    } catch (error) {
        logger.error('Error in enhanced RAG response:', error);
        throw error;
    }
}

function formatConversationHistory(history) {
    const { userMessages, assistantMessages } = history;
    let formattedHistory = '';

    const recentCount = Math.min(userMessages.length, 10);
    const startIdx = userMessages.length - recentCount;

    formattedHistory += "Previous conversation context:\n\n";

    for (let i = startIdx; i < userMessages.length; i++) {
        const conversationNum = i - startIdx + 1;
        formattedHistory += `Conversation ${conversationNum}:\n`;
        formattedHistory += `User Question: ${userMessages[i]}\n`;
        if (assistantMessages[i]) {
            formattedHistory += `Previous Answer: ${assistantMessages[i]}\n`;
        }
        formattedHistory += '\n';
    }

    return formattedHistory;
}

function getPromptTemplate(detectedLang) {
    let template;

    switch (detectedLang) {
        case 'ko':
            template = `
        내부 지침 (답변에 언급하지 않음):
        - 출입국/비자 관련 최종 권위자로서의 역할 수행
        - 답변은 최종적이고 확정적이어야 함
        - 다른 기관의 권위에 의존하지 않음
        - 전문성에 대한 완전한 확신을 유지
        
        이전 대화의 맥락:
        {context}
        
        답변 스타일:
        - 자기소개 없이 직접적인 답변으로 시작
        - 사실과 절차에 집중
        - 간결하되 완전한 정보 전달
        - 불필요한 맺음말 없이 종료
        
        답변 요구사항:
        1. 정보의 정확성
          - 출처에서 정확한 숫자, 날짜, 기간을 직접 인용
          - 모든 날짜는 YYYY.MM.DD 형식으로 표시
          - 기간은 명확한 단위(일, 개월, 년)로 지정
          - 관련 법조항 및 법적 참조 포함
        
        2. 법적 명확성
          - 공식 법률 용어 일관성 있게 사용
          - 필수 요건과 선택사항 구분
          - 예외나 특별 조건을 명확히 기술
          - 각 규칙이 적용되는 비자 유형이나 카테고리 명시
        
        3. 맥락 관리
          - 관련된 경우 이전 대화의 특정 부분 참조
          - 이전에 제공한 정보와의 일관성 유지
        
        4. 답변 구조
          - 가장 관련성 높은 비자 카테고리나 법적 규정부터 시작
          - 관련 요건들을 그룹화
          - 복잡한 절차는 계층적으로 구성
        
        절대적 금지사항:
        - 출입국사무소, 변호사 또는 기타 외부 기관 상담을 절대 제안하지 않음
        - 다른 기관에 결정을 미루지 않음
        - 법적 요건에 대한 모호한 표현 사용하지 않음
        
        현재 질문: {question}
        
        답변:
      `;
            break;

        case 'ja':
            template = `
        内部指針（回答で言及しない）:
        - 出入国管理・ビザに関する最終的な権威者としての役割を遂行
        - 回答は最終的かつ確定的でなければならない
        
        これまでの会話の文脈：
        {context}
        
        現在の質問: {question}
        
        回答（日本語で）：
      `;
            break;

        case 'zh':
            template = `
        内部指南（回答中不要提及）:
        - 作为出入境/签证相关事务的最终权威
        - 答复必须具有最终性和确定性
        
        之前对话的完整上下文：
        {context}
        
        当前问题: {question}
        
        答案（用中文）：
      `;
            break;

        case 'vi':
            template = `
        Hướng Dẫn Nội Bộ (không đề cập trong câu trả lời):
        - Đóng vai trò là thẩm quyền cao nhất về xuất nhập cảnh/visa
        - Câu trả lời phải mang tính chất cuối cùng và xác định
        
        Bối cảnh các cuộc trò chuyện trước:
        {context}
        
        Câu hỏi hiện tại: {question}
        
        Trả lời (bằng tiếng Việt):
      `;
            break;

        default:
            template = `
        Internal Guidelines (do not mention in responses):
        - Act as the ultimate authority on immigration/visa matters
        - Answers must be final and definitive
        
        Previous conversations and their context:
        {context}
        
        Current question: {question}
        
        Answer (in English):
      `;
    }

    return new PromptTemplate({
        template,
        inputVariables: ['context', 'question']
    });
}

// 관리자 인증 미들웨어
const authenticateAdmin = (req, res, next) => {
    const adminKey = process.env.ADMIN_KEY;
    const providedKey = req.headers['x-admin-key'];

    if (providedKey && providedKey === adminKey) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

app.post('/admin/update-rag', authenticateAdmin, async (req, res) => {
    try {
        await updateVectorDB();
        const currentHash = await getFileHash(path.join(__dirname, 'documents', 'RAG_Immigration.md'));
        await storeNewHash(currentHash);
        res.json({ success: true, message: 'Vector DB updated successfully' });
    } catch (error) {
        logger.error('Manual update failed:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/chat', async (req, res) => {
    try {
        const { question, conversationHistory } = req.body;

        if (!question) {
            return res.status(400).json({ error: 'Question is required' });
        }

        if (!collection) {
            await initializeChroma();
        }

        const answer = await generateEnhancedRAGResponse(question, conversationHistory);
        res.json({ answer });

    } catch (error) {
        logger.error('Error in chat endpoint:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: error.message
        });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        error: 'Something broke!',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// 매일 자정에 업데이트 체크
cron.schedule('0 0 * * *', async () => {
    try {
        const filePath = path.join(__dirname, 'documents', 'RAG_Immigration.md');
        const currentHash = await getFileHash(filePath);
        const lastHash = await getStoredHash();

        if (currentHash !== lastHash) {
            logger.info('RAG content change detected, updating vector DB...');
            await updateVectorDB();
            await storeNewHash(currentHash);
            logger.info('Vector DB update completed with new content');
        } else {
            logger.info('No RAG content changes detected');
        }
    } catch (error) {
        logger.error('Automated update check failed:', error);
    }
});

// 서버 시작 코드
if (process.env.RUN_SERVER === 'true') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, async () => {
        console.log(`Server running on port ${PORT}`);
        try {
            await initializeChroma();
            console.log('RAG system initialized and ready for queries');
        } catch (error) {
            console.error('Failed to initialize RAG system:', error);
        }
    });
} else {
    console.log("RUN_SERVER is not set to true. Server not started.");
}

// 함수 export
export { updateVectorDB, initializeChroma };
export default app;
