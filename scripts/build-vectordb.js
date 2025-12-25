/**
 * PDF 기반 벡터 DB 빌드 스크립트
 * source_data/ 디렉토리의 PDF 파일을 처리하여 임베딩을 생성하고 JSON으로 저장
 * 서버에서는 이 JSON을 로드하여 ChromaDB에 삽입
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { OpenAIEmbeddings } from '@langchain/openai';

// CommonJS require for pdf-parse (ESM compatibility)
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

const SOURCE_DIR = path.join(ROOT_DIR, 'source_data');
const HASH_FILE = path.join(ROOT_DIR, '.pdf-hash');
const OUTPUT_FILE = path.join(ROOT_DIR, 'vectordb_data.json');

// OpenAI 임베딩
const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY
});

/**
 * PDF 파일 해시 계산
 */
async function calculateHashes() {
    try {
        const files = await fs.readdir(SOURCE_DIR);
        const pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf'));

        const hashes = {};
        for (const file of pdfFiles) {
            const filePath = path.join(SOURCE_DIR, file);
            const content = await fs.readFile(filePath);
            hashes[file] = crypto.createHash('md5').update(content).digest('hex');
        }

        return hashes;
    } catch (error) {
        console.error('source_data 디렉토리를 찾을 수 없습니다.');
        return {};
    }
}

/**
 * 저장된 해시 로드
 */
async function loadStoredHashes() {
    try {
        const content = await fs.readFile(HASH_FILE, 'utf8');
        return JSON.parse(content);
    } catch {
        return {};
    }
}

/**
 * 해시 저장
 */
async function saveHashes(hashes) {
    await fs.writeFile(HASH_FILE, JSON.stringify(hashes, null, 2));
}

/**
 * PDF 텍스트 추출
 */
async function extractTextFromPDF(filePath) {
    console.log(`  📄 PDF 읽는 중: ${path.basename(filePath)}`);
    const dataBuffer = await fs.readFile(filePath);
    // PDFParse v2 requires Uint8Array
    const uint8Array = new Uint8Array(dataBuffer);
    const parser = new PDFParse(uint8Array);
    await parser.load();
    const result = await parser.getText();

    // getText() returns {pages: [{text, num}, ...]}
    if (result && result.pages && Array.isArray(result.pages)) {
        const textParts = result.pages.map(page => page.text || '');
        return textParts.join('\n\n');
    }

    return '';
}

/**
 * 텍스트 전처리 (향상된 버전)
 */
function preprocessText(text) {
    // 불필요한 공백 정리
    text = text.replace(/\s+/g, ' ').trim();

    // 숫자 정보 태깅
    text = text.replace(/(\d+(?:,\d+)*(?:\.\d+)?)/g, '<num>$1</num>');

    // 날짜 정보 태깅
    text = text.replace(/(\d{4}[\.\/\-]?\d{1,2}[\.\/\-]?\d{1,2})/g, '<date>$1</date>');

    // 기간 태깅
    text = text.replace(/(\d+)\s*(일|개월|년|주)/gi, '<duration>$1$2</duration>');

    // 비자 유형 태깅
    text = text.replace(/([\w\d\-]+\s*비자)/gi, '<visa>$1</visa>');

    return text;
}

/**
 * 텍스트 청킹 (의미 기반)
 */
function chunkText(text, source) {
    const chunks = [];

    // 페이지/섹션 기반 분할 (PDF 특성상 폼피드, 여러 줄바꿈으로 분리)
    const sections = text.split(/\n{3,}|\f/);

    let chunkId = 0;
    for (const section of sections) {
        const cleanedSection = section.trim();

        // 너무 짧은 섹션 건너뛰기
        if (cleanedSection.length < 100) continue;

        // 큰 섹션은 더 작은 청크로 분할
        if (cleanedSection.length > 2000) {
            const paragraphs = cleanedSection.split(/\n{2,}/);
            let currentChunk = '';

            for (const para of paragraphs) {
                if ((currentChunk + para).length > 1500) {
                    if (currentChunk.trim().length > 100) {
                        chunks.push({
                            id: `${source.replace(/[^a-zA-Z0-9]/g, '_')}_${chunkId++}`,
                            content: currentChunk.trim(),
                            metadata: {
                                source,
                                chunkIndex: chunkId,
                                contentLength: currentChunk.trim().length
                            }
                        });
                    }
                    currentChunk = para;
                } else {
                    currentChunk += '\n\n' + para;
                }
            }

            if (currentChunk.trim().length > 100) {
                chunks.push({
                    id: `${source.replace(/[^a-zA-Z0-9]/g, '_')}_${chunkId++}`,
                    content: currentChunk.trim(),
                    metadata: {
                        source,
                        chunkIndex: chunkId,
                        contentLength: currentChunk.trim().length
                    }
                });
            }
        } else {
            chunks.push({
                id: `${source.replace(/[^a-zA-Z0-9]/g, '_')}_${chunkId++}`,
                content: cleanedSection,
                metadata: {
                    source,
                    chunkIndex: chunkId,
                    contentLength: cleanedSection.length
                }
            });
        }
    }

    return chunks;
}

/**
 * 임베딩 생성 (배치 처리)
 */
async function generateEmbeddings(texts) {
    const MAX_CHARS = 6000; // 토큰 제한 고려
    const batchSize = 5;
    let allEmbeddings = [];

    // 텍스트 전처리 및 길이 제한
    const processedTexts = texts.map(text => {
        const processed = preprocessText(text);
        return processed.length > MAX_CHARS ? processed.substring(0, MAX_CHARS) : processed;
    });

    for (let i = 0; i < processedTexts.length; i += batchSize) {
        const batch = processedTexts.slice(i, i + batchSize);
        const progress = Math.round((i / processedTexts.length) * 100);
        console.log(`  📊 임베딩 생성 중... ${progress}% (${i}/${processedTexts.length})`);

        try {
            const batchEmbeddings = await embeddings.embedDocuments(batch);
            allEmbeddings = [...allEmbeddings, ...batchEmbeddings];

            // API 레이트 리밋 방지
            await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
            console.error(`  ❌ 배치 오류: ${error.message}`);

            // 개별 처리 시도
            for (const text of batch) {
                try {
                    const single = await embeddings.embedDocuments([text.substring(0, 3000)]);
                    allEmbeddings.push(single[0]);
                } catch {
                    console.error(`  ⚠️ 임베딩 실패, 빈 벡터 사용`);
                    allEmbeddings.push(new Array(1536).fill(0));
                }
            }
        }
    }

    return allEmbeddings;
}

/**
 * 메인 빌드 함수
 */
async function buildVectorDB() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('📚 PDF 기반 벡터 DB 빌드 시작');
    console.log('═══════════════════════════════════════════════════════\n');

    // 1. 해시 비교로 변경 확인
    console.log('1️⃣  파일 변경 확인...');
    const currentHashes = await calculateHashes();
    const storedHashes = await loadStoredHashes();

    const pdfFiles = Object.keys(currentHashes);
    if (pdfFiles.length === 0) {
        console.log('   ❌ source_data/ 디렉토리에 PDF 파일이 없습니다.');
        return;
    }
    console.log(`   📁 발견된 PDF: ${pdfFiles.length}개`);

    // 변경 감지
    let hasChanges = false;
    for (const file of pdfFiles) {
        if (currentHashes[file] !== storedHashes[file]) {
            console.log(`   📝 변경됨: ${file}`);
            hasChanges = true;
        }
    }

    for (const file of Object.keys(storedHashes)) {
        if (!currentHashes[file]) {
            console.log(`   🗑️ 삭제됨: ${file}`);
            hasChanges = true;
        }
    }

    // 기존 데이터 파일도 확인
    let existingData = false;
    try {
        await fs.access(OUTPUT_FILE);
        existingData = true;
    } catch { }

    if (!hasChanges && existingData) {
        console.log('   ✅ 변경 없음. 기존 벡터 데이터 사용.\n');
        return;
    }

    // 2. PDF 텍스트 추출 및 청킹
    console.log('\n2️⃣  PDF 처리 중...');
    const allChunks = [];

    for (const file of pdfFiles) {
        console.log(`\n   📖 처리 중: ${file}`);
        const filePath = path.join(SOURCE_DIR, file);

        try {
            const text = await extractTextFromPDF(filePath);
            console.log(`      추출된 문자: ${text.length.toLocaleString()}자`);

            const chunks = chunkText(text, file);
            console.log(`      생성된 청크: ${chunks.length}개`);
            allChunks.push(...chunks);
        } catch (error) {
            console.error(`      ❌ 오류: ${error.message}`);
        }
    }

    console.log(`\n   📊 총 청크 수: ${allChunks.length}개`);

    if (allChunks.length === 0) {
        console.log('   ❌ 처리할 청크가 없습니다.');
        return;
    }

    // 3. 임베딩 생성
    console.log('\n3️⃣  임베딩 생성 중...');
    const texts = allChunks.map(c => c.content);
    const embeddingVectors = await generateEmbeddings(texts);

    // 4. JSON으로 저장
    console.log('\n4️⃣  데이터 저장 중...');

    const output = {
        version: '1.0',
        createdAt: new Date().toISOString(),
        totalChunks: allChunks.length,
        documents: allChunks.map((chunk, i) => ({
            id: chunk.id,
            content: chunk.content,
            metadata: chunk.metadata,
            embedding: embeddingVectors[i]
        }))
    };

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(output));
    const fileSizeKB = (JSON.stringify(output).length / 1024).toFixed(1);

    // 5. 해시 저장
    await saveHashes(currentHashes);

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('✅ 벡터 DB 빌드 완료!');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`   📊 총 청크: ${allChunks.length}개`);
    console.log(`   💾 파일 크기: ${fileSizeKB} KB`);
    console.log(`   📁 저장 위치: ${OUTPUT_FILE}`);
    console.log('');
}

// 실행
buildVectorDB().catch(error => {
    console.error('❌ 빌드 실패:', error);
    process.exit(1);
});
