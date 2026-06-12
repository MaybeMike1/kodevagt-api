export type OllamaEmbedResponse = {
    embedding: number[];
};

export type OllamaChatMessage = {
    role: "system" | "user" | "assistant";
    content: string;
};

export type OllamaChatResponse = {
    message: { role: string; content: string };
};
