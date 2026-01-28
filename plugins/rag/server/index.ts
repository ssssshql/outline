import Logger from "@server/logging/Logger";
import { PluginManager, Hook } from "@server/utils/PluginManager";
import config from "../plugin.json";
import router from "./api/rag";
import env from "./env";
import { VectorStoreService } from "./VectorStoreService";
import DocumentIndexProcessor from "./processors/DocumentIndexProcessor";

// Check if RAG plugin is enabled
const enabled = !!(
    env.RAG_OPENAI_API_KEY &&
    (env.RAG_OPENAI_BASE_URL || env.RAG_CHAT_BASE_URL)
);

if (enabled) {
    // Register API routes
    PluginManager.add({
        ...config,
        type: Hook.API,
        value: router,
    });

    // Register document index processor
    PluginManager.add({
        ...config,
        type: Hook.Processor,
        value: DocumentIndexProcessor,
    });

    // Initialize vector store on startup
    void VectorStoreService.getInstance()
        .initialize()
        .then(() => {
            Logger.info("plugins", "RAG plugin initialized successfully");
        })
        .catch((error) => {
            Logger.error("RAG plugin initialization failed", error);
        });
} else {
    Logger.info(
        "plugins",
        "RAG plugin disabled - missing required environment variables (RAG_OPENAI_API_KEY and RAG_OPENAI_BASE_URL)"
    );
}
