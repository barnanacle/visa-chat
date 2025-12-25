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

        // 로딩 제거하고 응답 표시
        loadingMessageElement.textContent = data.answer;
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
    messageElement.textContent = message;
    chatBox.appendChild(messageElement);
    return messageElement;
}

function scrollToBottom() {
    const chatBox = document.getElementById('chat-box');
    chatBox.scrollTop = chatBox.scrollHeight;
}
