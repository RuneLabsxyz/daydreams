import { Conversation } from "./conversation";
import type { Memory, ConversationMetadata } from "./types";
import { ChromaVectorDB } from "./vector-db";
import { Logger } from "./logger";
import { LogLevel } from "./types";

export class ConversationManager {
    private logger: Logger;

    constructor(
        private vectorDb?: ChromaVectorDB,
        config: {
            logLevel?: LogLevel;
        } = {}
    ) {
        this.logger = new Logger({
            level: config.logLevel || LogLevel.INFO,
            enableColors: true,
            enableTimestamp: true,
        });
    }

    public async getConversation(
        conversationId: string
    ): Promise<Conversation | undefined> {
        if (!this.vectorDb) {
            this.logger.warn(
                "ConversationManager.getConversation",
                "No VectorDB provided"
            );
            return undefined;
        }

        try {
            const collection = await this.vectorDb.getCollectionForConversation(
                conversationId
            );
            const metadata = collection.metadata;

            if (!metadata?.platform || !metadata?.platformId) {
                this.logger.warn(
                    "ConversationManager.getConversation",
                    "Conversation missing required metadata",
                    { conversationId }
                );
                return undefined;
            }

            // Instantiate conversation using the stored metadata
            const conversation = new Conversation(
                metadata.platformId as string,
                metadata.platform as string,
                {
                    name: metadata.name as string,
                    description: metadata.description as string,
                    participants: metadata.participants as string[],
                    createdAt: new Date(metadata.created as string | number | Date),
                    lastActive: new Date(
                        (metadata.lastActive || metadata.created) as string | number | Date
                    ),
                }
            );

            // Load previously stored memories from the vector database and inject them into the conversation
            try {
                const storedMemories = await this.vectorDb.getMemoriesFromConversation(conversationId);
                const formattedMemories = storedMemories.map((m) => ({
                    // Use the stored memoryId if present
                    id: m.metadata?.memoryId || m.metadata?.id,
                    conversationId: conversation.id,
                    content: m.content,
                    timestamp: new Date(m.metadata?.timestamp),
                    metadata: m.metadata,
                }));
                conversation.loadMemories(formattedMemories);
            } catch (error) {
                this.logger.warn(
                    "ConversationManager.getConversation",
                    "Failed to load memories",
                    {
                        error: error instanceof Error ? error.message : String(error),
                        conversationId,
                    }
                );
            }

            return conversation;
        } catch (error) {
            this.logger.error(
                "ConversationManager.getConversation",
                "Failed to get conversation",
                {
                    error: error instanceof Error ? error.message : String(error),
                    conversationId,
                }
            );
            return undefined;
        }
    }

    public async getConversationByPlatformId(
        platformId: string,
        platform: string
    ): Promise<Conversation | undefined> {
        if (platform === "consciousness") {
            platformId = "main";
        }

        const conversationId = Conversation.createDeterministicId(
            platform,
            platformId
        );
        return this.getConversation(conversationId);
    }

    public async createConversation(
        platformId: string,
        platform: string,
        metadata?: Partial<ConversationMetadata & { userId?: string }>
    ): Promise<Conversation> {
        if (!this.vectorDb) {
            throw new Error("VectorDB required for conversation creation");
        }

        const conversation = new Conversation(platformId, platform, metadata);

        try {
            const collection = await this.vectorDb.getCollectionForConversation(
                conversation.id
            );

            // Update collection with full conversation metadata including userId
            await collection.modify({
                metadata: {
                    description: "Conversation-specific memory storage",
                    conversationId: conversation.id,
                    platform: conversation.platform,
                    platformId: conversation.platformId,
                    created: conversation.getMetadata().createdAt.toISOString(),
                    lastActive: conversation
                        .getMetadata()
                        .lastActive.toISOString(),
                    name: metadata?.name,
                    participants: metadata?.participants,
                    userId: metadata?.userId, // Include userId in collection metadata
                },
            });

            this.logger.debug(
                "ConversationManager.createConversation",
                "Conversation collection created",
                {
                    conversationId: conversation.id,
                    platform,
                    platformId,
                    userId: metadata?.userId, // Log userId
                }
            );

            return conversation;
        } catch (error) {
            this.logger.error(
                "ConversationManager.createConversation",
                "Failed to create conversation collection",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    conversationId: conversation.id,
                    userId: metadata?.userId, // Log userId in errors
                }
            );
            throw error;
        }
    }

    public async addMemory(
        conversationId: string,
        content: string,
        metadata: Record<string, any> = {}
    ): Promise<Memory> {
        if (!this.vectorDb) {
            throw new Error("VectorDB required for adding memories");
        }

        const conversation = await this.getConversation(conversationId);
        if (!conversation) {
            throw new Error(`Conversation ${conversationId} not found`);
        }

        // First add to the in-memory conversation object
        const memory = await conversation.addMemory(content, metadata);

        try {
            // Then store in the vector database
            await this.vectorDb.storeInConversation(
                memory.content,
                conversation.id,
                {
                    memoryId: memory.id,
                    timestamp: memory.timestamp.toISOString(),
                    platform: conversation.platform,
                    platformId: conversation.platformId,
                    ...metadata,
                }
            );

            this.logger.debug(
                "ConversationManager.addMemory",
                "Memory stored successfully",
                {
                    memoryId: memory.id,
                    conversationId: conversation.id,
                }
            );

            return memory;
        } catch (error) {
            this.logger.error(
                "ConversationManager.addMemory",
                "Failed to store memory",
                {
                    error: error instanceof Error ? error.message : String(error),
                    memoryId: memory.id,
                    conversationId: conversation.id,
                }
            );
            throw error;
        }
    }

    public async findSimilarMemoriesInConversation(
        content: string,
        conversationId: string,
        limit = 5
    ): Promise<Memory[]> {
        if (!this.vectorDb) {
            throw new Error("VectorDB required for finding memories");
        }

        const conversation = await this.getConversation(conversationId);
        if (!conversation) {
            throw new Error(`Conversation ${conversationId} not found`);
        }

        try {
            const results = await this.vectorDb.findSimilarInConversation(
                content,
                conversationId,
                limit
            );

            return results.map((result) => ({
                id: result.metadata?.memoryId,
                conversationId,
                content: result.content,
                timestamp: new Date(result.metadata?.timestamp),
                metadata: {
                    ...result.metadata,
                    platform: conversation.platform,
                    platformId: conversation.platformId,
                },
            }));
        } catch (error) {
            this.logger.error(
                "ConversationManager.findSimilarMemoriesInConversation",
                "Failed to find similar memories",
                {
                    error: error instanceof Error ? error.message : String(error),
                    conversationId,
                }
            );
            throw error;
        }
    }

    public async listConversations(): Promise<Conversation[]> {
        if (!this.vectorDb) {
            return [];
        }

        const conversationIds = await this.vectorDb.listConversations();
        const conversations: Conversation[] = [];

        for (const conversationId of conversationIds) {
            const conversation = await this.getConversation(conversationId);
            if (conversation) {
                conversations.push(conversation);
            }
        }

        return conversations;
    }

    public async ensureConversation(
        name: string,
        platform: string,
        userId?: string
    ): Promise<Conversation> {
        let conversation = await this.getConversationByPlatformId(
            name,
            platform
        );
        if (!conversation) {
            conversation = await this.createConversation(name, platform, {
                name,
                description: `Conversation for ${name}`,
                participants: [],
                userId, // Add userId to metadata
            });
        }
        return conversation;
    }

    public async deleteConversation(conversationId: string): Promise<void> {
        if (!this.vectorDb) {
            return;
        }

        await this.vectorDb.deleteConversation(conversationId);
        this.logger.info(
            "ConversationManager.deleteConversation",
            "Conversation deleted",
            { conversationId }
        );
    }

    public async getMemoriesFromConversation(
        conversationId: string,
        limit?: number
    ): Promise<Memory[]> {
        if (!this.vectorDb) {
            throw new Error("VectorDB required for getting memories");
        }

        const conversation = await this.getConversation(conversationId);
        if (!conversation) {
            throw new Error(`Conversation ${conversationId} not found`);
        }

        try {
            const memories = await this.vectorDb.getMemoriesFromConversation(
                conversationId,
                limit
            );

            return memories.map((memory) => ({
                id: memory.metadata?.memoryId || memory.metadata?.id,
                conversationId,
                content: memory.content,
                timestamp: new Date(memory.metadata?.timestamp),
                metadata: memory.metadata,
            }));
        } catch (error) {
            this.logger.error(
                "ConversationManager.getMemoriesFromConversation",
                "Failed to get memories",
                {
                    error: error instanceof Error ? error.message : String(error),
                    conversationId,
                }
            );
            throw error;
        }
    }

    public async hasProcessedContentInConversation(
        contentId: string,
        conversationId: string
    ): Promise<boolean> {
        if (!this.vectorDb) {
            throw new Error("VectorDB required for getting memories");
        }

        const conversation = await this.getConversation(conversationId);
        if (!conversation) {
            this.logger.error(
                "ConversationManager.markContentAsProcessed",
                "Conversation not found",
                {
                    conversationId,
                }
            );
            return false;
        }

        return await this.vectorDb.hasProcessedContent(contentId, conversation);
    }

    public async markContentAsProcessed(
        contentId: string,
        conversationId: string
    ): Promise<boolean> {
        if (!this.vectorDb) {
            throw new Error(
                "VectorDB required for marking content as processed"
            );
        }

        const conversation = await this.getConversation(conversationId);

        if (!conversation) {
            this.logger.error(
                "ConversationManager.markContentAsProcessed",
                "Conversation not found",
                {
                    conversationId,
                }
            );
            return false;
        }

        await this.vectorDb.markContentAsProcessed(contentId, conversation);
        return true;
    }
}
