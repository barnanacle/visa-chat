// API 엔드포인트 설정
const API_BASE_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3003'
    : 'https://visachat.bluedawn.kr';

function checkEnter(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

// 대화 기록 저장
let userMessages = [];
let assistantMessages = [];

// 페이지 로드 시 안내 메시지
window.onload = function () {
    setTimeout(() => {
        const initialMessage = "안녕하세요! 대한민국 출입국/비자 관련 질문에 답변해 드리는 VisaChat입니다. 무엇을 도와드릴까요?";
        appendMessage(initialMessage, 'receive');
        assistantMessages.push(initialMessage);
        scrollToBottom();
    }, 500);
};

/**
 * 간단한 마크다운을 HTML로 변환
 */
function parseMarkdown(text) {
    if (!text) return '';

    // XSS 방지를 위한 HTML 이스케이프
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // 링크 처리 [텍스트](URL) - HTML 이스케이프 전에 처리해야 함
    // URL에서 이스케이프된 문자 복원
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2" target="_blank" class="form-link">$1</a>');

    // 줄바꿈 처리
    html = html.replace(/\n/g, '<br>');

    // 굵은 글씨 (**text** 또는 __text__)
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // 기울임 (*text* 또는 _text_) - 단, ** 내부는 제외
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

    // 번호 매기기 (1. 2. 3. 등) - 줄 시작에서
    html = html.replace(/(^|\<br\>)(\d+)\.\s+/g, '$1<span class="list-number">$2.</span> ');

    // 글머리 기호 (- 로 시작하는 줄) - "-"를 "•"로 완전 교체
    html = html.replace(/(^|<br>)-\s*/g, '$1<span class="list-bullet">•</span> ');

    // 제목 스타일 (### 또는 ##) - 간단한 강조로 변환
    html = html.replace(/(^|\<br\>)#{1,3}\s+(.+?)(\<br\>|$)/g, '$1<strong class="heading">$2</strong>$3');

    return html;
}

async function sendMessage() {
    const userInputElement = document.getElementById('user-input');
    const message = userInputElement.value.trim();
    if (!message) return;

    // 사용자 메시지 표시
    appendMessage(message, 'send');
    userMessages.push(message);
    userInputElement.value = '';

    // 로딩 애니메이션 표시
    const loadingMessageElement = appendMessage('', 'receive');
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'typing-indicator';
    loadingIndicator.innerHTML = '<div></div><div></div><div></div>';
    loadingMessageElement.appendChild(loadingIndicator);
    scrollToBottom();

    try {
        const response = await fetch(`${API_BASE_URL}/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                question: message,
                conversationHistory: {
                    userMessages: userMessages.slice(0, -1), // 현재 메시지 제외
                    assistantMessages: assistantMessages
                }
            }),
        });

        if (!response.ok) {
            throw new Error('Request Failed with status ' + response.status);
        }

        const data = await response.json();

        // 로딩 제거하고 응답 표시 (마크다운 파싱)
        loadingMessageElement.innerHTML = parseMarkdown(data.answer);
        assistantMessages.push(data.answer);
        scrollToBottom();

    } catch (error) {
        console.error("오류:", error);
        loadingMessageElement.textContent = '죄송합니다. 요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
        scrollToBottom();
    }
}

function appendMessage(message, className) {
    const chatBox = document.getElementById('chat-box');
    const messageElement = document.createElement('p');
    messageElement.className = className;

    // receive 클래스인 경우 마크다운 파싱 적용
    if (className === 'receive' && message) {
        messageElement.innerHTML = parseMarkdown(message);
    } else {
        messageElement.textContent = message;
    }

    chatBox.appendChild(messageElement);
    return messageElement;
}

function scrollToBottom() {
    const chatBox = document.getElementById('chat-box');
    chatBox.scrollTop = chatBox.scrollHeight;
}
