// 변수 생성
let userMessages = [];
let assistantMessages = [];

// Enter 키 처리 및 자동 높이 조절 함수
function checkEnter(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault(); // Enter 키의 기본 동작 방지
        sendMessage();
    }
    adjustTextareaHeight(event.target);
}

// Textarea 높이 자동 조절
function adjustTextareaHeight(textarea) {
    textarea.style.height = 'auto'; // 높이 초기화
    textarea.style.height = (textarea.scrollHeight) + 'px'; // 내용에 맞게 높이 조절
}

async function sendMessage() {
    const userInputElement = document.getElementById('user-input');
    const message = userInputElement.value.trim();
    if (!message) return;

    appendMessage(message, 'send');
    userMessages.push(message);
    
    // 입력창 초기화 및 높이 리셋
    userInputElement.value = '';
    adjustTextareaHeight(userInputElement);

    const loadingMessageElement = appendMessage('', 'receive');
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'typing-indicator';
    loadingIndicator.innerHTML = '<div></div><div></div><div></div>';
    loadingMessageElement.appendChild(loadingIndicator);

    scrollToBottom();

    try {
        const response = await fetch("http://localhost:3000/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                question: message
            }),
        });

        if (!response.ok) {
            throw new Error('Request Failed with status ' + response.status);
        }

        const data = await response.json();
        
        let formattedAnswer = data.answer.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        loadingMessageElement.innerHTML = formattedAnswer;
        
        assistantMessages.push(data.answer);
        scrollToBottom();

    } catch (error) {
        console.error("Error:", error);
        loadingMessageElement.innerHTML = '죄송합니다. 서버 연결에 문제가 발생했습니다.';
        scrollToBottom();
    }
}

function appendMessage(message, className) {
    const chatBox = document.getElementById('chat-box');
    const messageElement = document.createElement('p');
    messageElement.className = className;
    
    let formattedMessage = message;
    formattedMessage = formattedMessage.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    messageElement.innerHTML = formattedMessage;
    chatBox.appendChild(messageElement);
    return messageElement;
}

function scrollToBottom() {
    const chatBox = document.getElementById('chat-box');
    chatBox.scrollTop = chatBox.scrollHeight;
}

// 페이지 로드 시 초기화
window.onload = function() {
    const textarea = document.getElementById('user-input');
    
    // 입력 내용이 변경될 때마다 높이 조절
    textarea.addEventListener('input', function() {
        adjustTextareaHeight(this);
    });

    // 초기 높이 설정
    adjustTextareaHeight(textarea);

    // 초기 인사 메시지
    setTimeout(() => {
        const initialMessage = "안녕하세요! 한국 비자와 출입국에 관해 궁금하신 점을 물어보세요.\n\nHello! Please feel free to ask questions about Korean visas and immigration.\n\nこんにちは！韓国のビザと出入国に関するご質問をどうぞ。\n\n您好！请随时询问有关韩国签证和出入境的问题。\n\nXin chào! Hãy tự nhiên đặt câu hỏi về thị thực và xuất nhập cảnh Hàn Quốc.\n\nSupported Languages: 한국어, English, 日本語, 中文, Tiếng Việt";
        appendMessage(initialMessage, 'receive');
        assistantMessages.push(initialMessage);
        scrollToBottom();
    }, 1000);
};

async function sendMessage() {
    const userInputElement = document.getElementById('user-input');
    const message = userInputElement.value;
    if (!message) return;

    appendMessage(message, 'send');
    userMessages.push(message);
    userInputElement.value = '';

    const loadingMessageElement = appendMessage('', 'receive');
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'typing-indicator';
    loadingIndicator.innerHTML = '<div></div><div></div><div></div>';
    loadingMessageElement.appendChild(loadingIndicator);

    scrollToBottom();

    try {
        const response = await fetch("https://rr7yx755i2.execute-api.ap-northeast-2.amazonaws.com/default/visa-chat-lambda", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              question: message
            }),
          });

        if (!response.ok) {
            throw new Error('Request Failed with status ' + response.status);
        }

        const data = await response.json();
        
        // 여기를 수정: textContent 대신 innerHTML 사용
        let formattedAnswer = data.answer.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        loadingMessageElement.innerHTML = formattedAnswer;
        
        assistantMessages.push(data.answer);
        scrollToBottom();

    } catch (error) {
        console.error("Error:", error);
        loadingMessageElement.innerHTML = '죄송합니다. 서버 연결에 문제가 발생했습니다.';
        scrollToBottom();
    }
}

// appendMessage 함수 수정
function appendMessage(message, className) {
    const chatBox = document.getElementById('chat-box');
    const messageElement = document.createElement('p');
    messageElement.className = className;
    
    // 마크다운 처리
    let formattedMessage = message;
    formattedMessage = formattedMessage.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // HTML 적용
    messageElement.innerHTML = formattedMessage;
    chatBox.appendChild(messageElement);
    return messageElement;
}

function scrollToBottom() {
    const chatBox = document.getElementById('chat-box');
    chatBox.scrollTop = chatBox.scrollHeight;
}