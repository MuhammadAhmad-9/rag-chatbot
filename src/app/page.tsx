"use client";

import { useRef, useEffect, useState } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export default function ChatPage() {
  const [textInput, setTextInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<"idle" | "submitted" | "streaming">("idle");

  const isLoading = status === "submitted" || status === "streaming";
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!textInput.trim() || isLoading) return;

    const userMessageText = textInput.trim();
    setTextInput("");
    setStatus("submitted");

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: userMessageText,
    };

    const assistantMessageId = crypto.randomUUID();
    const initialAssistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
    };

    const currentHistoryContext = [...messages];

    setMessages((prev) => [...prev, userMessage, initialAssistantMessage]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userMessageText,
          history: currentHistoryContext,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to initialize stream from server routing pipeline.");
      }

      setStatus("streaming");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        accumulatedContent += chunk;

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: accumulatedContent }
              : msg
          )
        );
      }
    } catch (error) {
      console.error("Streaming process aborted:", error);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, content: "⚠️ Connection error. Unable to process response streaming." }
            : msg
        )
      );
    } finally {
      setStatus("idle");
    }
  };

  return (
    <div className="flex flex-col h-screen bg-neutral-50 text-neutral-900">
      <header className="bg-white border-b border-neutral-200 px-6 py-4 shadow-sm flex items-center justify-center shrink-0">
        <h1 className="text-xl font-semibold text-neutral-800 tracking-tight">RAG Pipeline</h1>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 w-full max-w-3xl mx-auto space-y-6">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-400">
            <p>Send a message to start the conversation.</p>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.role === "assistant" && msg.content === "" && status === "submitted") {
              return null;
            }
            return (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-5 py-3 shadow-sm text-[15px] leading-relaxed ${
                    msg.role === "user"
                      ? "bg-black text-white rounded-br-none"
                      : "bg-white border border-neutral-200 text-neutral-800 rounded-bl-none"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            );
          })
        )}

        {status === "submitted" && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl px-5 py-3.5 shadow-sm bg-white border border-neutral-200 text-neutral-800 rounded-bl-none flex items-center space-x-1.5">
              <div className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce"></div>
              <div className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></div>
              <div className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      <footer className="bg-white border-t border-neutral-200 p-4 shrink-0">
        <div className="max-w-3xl mx-auto">
          <form onSubmit={handleSendMessage} className="flex space-x-3 items-end">
            <textarea
              name="prompt"
              className="flex-1 resize-none overflow-hidden rounded-xl border border-neutral-300 bg-white px-4 py-3 text-[15px] text-neutral-900 focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent min-h-[48px] max-h-32 shadow-sm transition-shadow placeholder:text-neutral-400 disabled:opacity-60"
              rows={1}
              placeholder="Message the assistant..."
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              disabled={isLoading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
            />
            <button
              type="submit"
              disabled={isLoading || !textInput.trim()}
              className="inline-flex h-[48px] items-center justify-center rounded-xl bg-black px-6 py-3 font-medium text-white shadow-sm transition-all hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 disabled:bg-neutral-300 disabled:text-neutral-500 disabled:cursor-not-allowed shrink-0"
            >
              Send
            </button>
          </form>
        </div>
      </footer>
    </div>
  );
}