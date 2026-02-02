import Logger from "@server/logging/Logger";
import { PluginManager, Hook } from "@server/utils/PluginManager";
import config from "../plugin.json";
import router from "./api/rag";
import { VectorStoreService } from "./VectorStoreService";
import DocumentIndexProcessor from "./processors/DocumentIndexProcessor";

// Always register API routes to allow configuration via UI
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
