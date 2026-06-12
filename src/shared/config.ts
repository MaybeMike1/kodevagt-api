const isProduction = process.env.NODE_ENV === "production";

export const config = {
    get githubToken() {
        return process.env.GITHUB_TOKEN;
    },
    get githubClientId() {
        return process.env.GITHUB_CLIENT_ID;
    },
    get githubClientSecret() {
        return process.env.GITHUB_CLIENT_SECRET;
    },
    /** Backend callback — must match the GitHub OAuth app settings. */
    get githubOAuthRedirectUri() {
        return process.env.GITHUB_OAUTH_REDIRECT_URI ?? "http://localhost:3000/auth/github/callback";
    },
    /** Web frontend redirect after OAuth (hash fragment). */
    get githubOAuthFrontendRedirectUri() {
        return process.env.GITHUB_OAUTH_FRONTEND_REDIRECT_URI ?? "http://localhost:1420/auth/callback";
    },
    /** Tauri deep link after desktop OAuth handoff. */
    get githubOAuthDesktopRedirectUri() {
        return process.env.GITHUB_OAUTH_DESKTOP_REDIRECT_URI ?? "kodevagt://auth/callback";
    },
    get githubOAuthScopes() {
        return process.env.GITHUB_OAUTH_SCOPES ?? "repo";
    },
    get isProduction() {
        return isProduction;
    },
    get ollamaBaseUrl() {
        return process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
    },
    get ollamaEmbedModel() {
        return process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
    },
    get ollamaChatModel() {
        return process.env.OLLAMA_CHAT_MODEL ?? "qwen2.5-coder:7b";
    },
    get ollamaVerifierModel() {
        return process.env.OLLAMA_VERIFIER_MODEL ?? process.env.REVIEW_VERIFIER_MODEL ?? this.ollamaChatModel;
    },
    get vectorDbPath() {
        return process.env.VECTOR_DB_PATH ?? "./data/vector";
    },
    get vectorStoreBackend() {
        return process.env.VECTOR_STORE ?? "lance";
    },
    get indexMaxFiles() {
        return Number(process.env.INDEX_MAX_FILES ?? "2000");
    },
    get indexChunkChars() {
        return Number(process.env.INDEX_CHUNK_CHARS ?? "3500");
    },
    get indexChunkOverlap() {
        return Number(process.env.INDEX_CHUNK_OVERLAP ?? "0.15");
    },
    /**
     * Fast review preset: disables verifier and global query, reranks once per PR
     * (not per file), raises batch size, and parallelizes retrieval. Individual
     * REVIEW_* vars still override when set explicitly.
     */
    get reviewFastMode() {
        return process.env.REVIEW_FAST_MODE === "true";
    },
    get reviewTopK() {
        return Number(process.env.REVIEW_TOP_K ?? "8");
    },
    /** Max RAG snippets sent to the review generator for the whole PR. */
    get reviewMaxSnippets() {
        return Number(process.env.REVIEW_MAX_SNIPPETS ?? "16");
    },
    /** Top-K for the optional global PR query (cross-file context). */
    get reviewGlobalQueryTopK() {
        return Number(process.env.REVIEW_GLOBAL_QUERY_TOP_K ?? "4");
    },
    get reviewGlobalQueryEnabled() {
        const raw = process.env.REVIEW_GLOBAL_QUERY_ENABLED;
        if (raw !== undefined) return raw !== "false";
        return !this.reviewFastMode;
    },
    get reviewVerifierEnabled() {
        const raw = process.env.REVIEW_VERIFIER_ENABLED;
        if (raw !== undefined) return raw !== "false";
        return !this.reviewFastMode;
    },
    get reviewHybridVectorWeight() {
        return Number(process.env.REVIEW_HYBRID_VECTOR_WEIGHT ?? "0.7");
    },
    get reviewHybridKeywordWeight() {
        return Number(process.env.REVIEW_HYBRID_KEYWORD_WEIGHT ?? "0.3");
    },
    get reviewRerankerEnabled() {
        return process.env.REVIEW_RERANKER_ENABLED !== "false";
    },
    /**
     * When false, skip per-file LLM rerank and rerank once at PR level instead.
     * Defaults to false in REVIEW_FAST_MODE.
     */
    get reviewRerankPerQuery() {
        const raw = process.env.REVIEW_RERANK_PER_QUERY;
        if (raw !== undefined) return raw !== "false";
        return !this.reviewFastMode;
    },
    /** How many fused candidates are sent to the LLM reranker per query. */
    get reviewRerankerTopN() {
        return Number(process.env.REVIEW_RERANKER_TOP_N ?? "20");
    },
    /**
     * Skip LLM rerank when the top candidate's heuristic boost is at least this value
     * (path/line/symbol overlap). Set to 0 to never skip. Fast mode uses a lower bar.
     */
    get reviewRerankSkipHeuristicMin() {
        const raw = process.env.REVIEW_RERANK_SKIP_HEURISTIC_MIN;
        if (raw !== undefined) return Number(raw);
        return this.reviewFastMode ? 0.45 : 0.55;
    },
    /** Max parallel file-query retrievals per PR (embed + vector search). */
    get reviewRetrievalConcurrency() {
        const raw = process.env.REVIEW_RETRIEVAL_CONCURRENCY;
        if (raw !== undefined) return Math.max(1, Number(raw));
        return this.reviewFastMode ? 4 : 3;
    },
    /** Weight on the LLM rerank score when fused with heuristic boosts. */
    get reviewRerankerWeight() {
        return Number(process.env.REVIEW_RERANKER_WEIGHT ?? "0.6");
    },
    /** Lambda for MMR diversity at snippet pack time (1.0 = pure relevance). */
    get reviewMmrLambda() {
        return Number(process.env.REVIEW_MMR_LAMBDA ?? "0.7");
    },
    get ollamaRerankerModel() {
        return process.env.OLLAMA_RERANKER_MODEL ?? this.ollamaChatModel;
    },
    get reviewDebug() {
        return process.env.REVIEW_DEBUG === "true";
    },
    /** Log incoming HTTP requests (method, path, status, duration). Set REQUEST_LOG=false to disable. */
    get requestLog() {
        return process.env.REQUEST_LOG !== "false";
    },
    /** Max changed files per LLM call (larger PRs are reviewed in batches). Fast mode: 15. */
    get reviewBatchFileCount() {
        const raw = process.env.REVIEW_BATCH_FILE_COUNT;
        if (raw !== undefined) return Number(raw);
        return this.reviewFastMode ? 15 : 5;
    },
    /**
     * Max changed files to review end-to-end (retrieval + generator). 0 = unlimited.
     * Fast mode default: 15 — largest diffs first.
     */
    get reviewMaxFilesToReview() {
        const raw = process.env.REVIEW_MAX_FILES;
        if (raw !== undefined) return Number(raw);
        return this.reviewFastMode ? 15 : 0;
    },
    /** Max Ollama chat attempts per generator batch (initial + retries). Fast mode: 1. */
    get reviewGeneratorMaxAttempts() {
        const raw = process.env.REVIEW_GENERATOR_MAX_ATTEMPTS;
        if (raw !== undefined) return Math.max(1, Number(raw));
        return this.reviewFastMode ? 1 : 2;
    },
    /** num_predict for review chat calls. Fast mode: 2048. */
    get reviewChatNumPredict() {
        const raw = process.env.REVIEW_CHAT_NUM_PREDICT;
        if (raw !== undefined) return Number(raw);
        return this.reviewFastMode ? 2048 : 4096;
    },
    /** Log per-phase review latency (github, retrieval, generator, verifier). */
    get reviewTimingLog() {
        return process.env.REVIEW_TIMING_LOG !== "false";
    },
    /** Max total findings returned to the client. */
    get reviewMaxFindings() {
        return Number(process.env.REVIEW_MAX_FINDINGS ?? "12");
    },
    /**
     * Target confidence for the strict tier (0 = skip strict tier).
     * Default 0.8 — falls back to reviewMinConfidence when nothing passes.
     */
    get reviewTargetConfidence() {
        const raw = process.env.REVIEW_TARGET_CONFIDENCE;
        if (raw !== undefined) return Math.min(1, Math.max(0, Number(raw)));
        return 0.8;
    },
    /**
     * Minimum confidence for the relaxed tier. Set REVIEW_MIN_CONFIDENCE=0 to disable all filtering.
     * Default 0.65.
     */
    get reviewMinConfidence() {
        const raw = process.env.REVIEW_MIN_CONFIDENCE;
        if (raw !== undefined) return Math.min(1, Math.max(0, Number(raw)));
        return 0.65;
    },
    /**
     * When true, strict tier prefers verifier "supported" (partial still allowed with valid citation).
     */
    get reviewRequireSupported() {
        const raw = process.env.REVIEW_REQUIRE_SUPPORTED;
        if (raw !== undefined) return raw !== "false";
        return false;
    },
    /** When strict/relaxed tiers return nothing, include best cited findings (not hallucinated). */
    get reviewQualityFallback() {
        return process.env.REVIEW_QUALITY_FALLBACK !== "false";
    },
    /** When true, POST /review starts a background job (202) instead of blocking. */
    get reviewAsyncDefault() {
        return process.env.REVIEW_ASYNC !== "false";
    },
    /** Poll interval when waiting on a review job (sync client helper). */
    get reviewJobPollIntervalMs() {
        return Number(process.env.REVIEW_JOB_POLL_MS ?? "1500");
    },
    /** Max wait for sync helper / client polling. */
    get reviewJobMaxWaitMs() {
        return Number(process.env.REVIEW_JOB_MAX_WAIT_MS ?? "240000");
    },
    get embeddingDimensions() {
        return Number(process.env.EMBEDDING_DIMENSIONS ?? "768");
    },
    get corsOrigins(): string[] {
        const raw = process.env.CORS_ORIGINS;
        if (raw) {
            return raw.split(",").map((origin) => origin.trim()).filter(Boolean);
        }
        return [
            "http://localhost:1420",
            "http://127.0.0.1:1420",
            "http://tauri.localhost",
            "https://tauri.localhost",
        ];
    },
};

export function isOAuthConfigured(): boolean {
    return Boolean(config.githubClientId && config.githubClientSecret);
}
