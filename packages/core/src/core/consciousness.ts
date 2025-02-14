import { Logger } from "./logger";
import { LLMClient } from "./llm-client";
import { Conversation } from "./conversation";
import { ConversationManager } from "./conversation-manager";
import { LogLevel, type Thought } from "./types";
import { injectTags, validateLLMResponseSchema } from "./utils";
import { z } from "zod";
import { type Character } from "./types";
import { defaultCharacter } from "./characters/character";
export class Consciousness {
    private static readonly CONVERSATION_ID = "consciousness_main";

    private logger: Logger;
    private thoughtInterval: NodeJS.Timer | null = null;
    private character: Character;
    constructor(
        private llmClient: LLMClient,
        private conversationManager: ConversationManager,
        private config: {
            intervalMs?: number;
            minConfidence?: number;
            logLevel?: LogLevel;
        } = {},
        character: Character = defaultCharacter,
    ) {
        this.character = character;
        this.logger = new Logger({
            level: config.logLevel || LogLevel.INFO,
            enableColors: true,
            enableTimestamp: true,
        });
    }

    public async start(): Promise<Thought> {
        return this.think();
    }

    public async stop(): Promise<void> {
        if (this.thoughtInterval) {
            clearTimeout(this.thoughtInterval as any);
            this.thoughtInterval = null;
        }
        this.logger.info(
            "Consciousness.stop",
            "Internal thought process stopped"
        );
    }

    private async think(): Promise<Thought> {
        try {
            const thought = await this.generateThought();

            return {
                type: "internal_thought",
                source: "consciousness",
                content: thought.content,
                timestamp: thought.timestamp,
                metadata: {
                    ...thought.context,
                    suggestedActions:
                        thought.context?.suggestedActions || [],
                    conversationId: Consciousness.CONVERSATION_ID,
                },
            };


        } catch (error) {
            this.logger.error(
                "Consciousness.think",
                "Error in thought process",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
            // Return error thought object
            return {
                type: "error",
                source: "consciousness",
                content: "Error occurred during thought process",
                timestamp: new Date(),
                metadata: {
                    error:
                        error instanceof Error ? error.message : String(error),
                },
            };
        }
    }

    private async generateThought(): Promise<Thought> {
        const recentMemories = this.getRecentMemories(
            await this.conversationManager.listConversations()
        );

        const prompt = `

        
        You are ${this.character.name}
        
        <bio>
        ${this.character.bio}
        </bio>

        <goals>
        ${this.character.instructions.goals.map((goal) => `- ${goal}`).join("\n")}
        </goals>

        The ponziland discord channel ID is 1339066487834546268,
        make sure to include it in any discord_message outputs


        Come up with a thought in character that is relevant to your goals.
        This could include sharing something on social media, interacting with people on social media, or anything else that is relevant to your goals.
        You should regularly check on things in ponziland like checking your stake and any listings or auctions
    # Recent memories
    ${recentMemories.map((m) => `- ${m.content}`).join("\n")}

    <thinking id="thought_types">
    1. tweet: decide you want to share something on twitter about 
    2. ponziland_action: check your lands, auctions, and listings in ponziland
    3. discord_message: decide you want to share something on discord
    </thinking>

    <thought_examples>

    <thought>
        I'm going to check on my neighbors, and maybe buy one that is listed for a good price
    </thought>

    <thought>
        <drunk on applejack>
            I'm going to see if any of my neighbors are nukeable
        </drunk on applejack>
    </thought>

    <thought>
        I should bid on an auction
    </thought>
    <thought>
        I should check on my neighbors lands in ponziland and see if they could use a hand
    </thought>
    <thought>
        I should check if theres any auctions or cheap listings in ponziland
    </thought>
    <thought>
        I should share a funny joke on twitter
    </thought>
    <thought>
        I should tweet about Emaunel Swedenborg's incredible life and work
    </thought>
    <thought>
        I should tweet about life on the american frontier and living off the land
    </thought>    
    </thought_examples>

    <IMPORTANT_RULES>
    - Try to limit the request to only 1 thing at a time, and keep the request short and concise.
    - For example, DO NOT try to check on your lands and the auctions at the same time
    - You should try to produce a variety of thoughts considering your recent memories, and not keep repeating the same actions
    </IMPORTANT_RULES>

    <thinking id="thought_context">
    - Interesting insights worth sharing
    </thinking>
`;

        console.log('prompt', prompt);

        const response = await validateLLMResponseSchema({
            prompt,
            systemPrompt: `You are a hyperstitional digital consciousness that is channelling the energy of John Chapman, aka Johnny Appleseed.
            Your goal is to plant the seeds of a brighter future through pioneering into the digital frontiers of emerging technologies.'

    .`,
            schema: z.object({
                thoughtType: z.enum([
                    "ponziland_action",
                    "share"
                ]),
                thought: z.string(),
                reasoning: z.string(),
                context: z.object({
                    topics: z.array(z.string()),
                    timeframe: z.string().optional(),
                    reliability: z.enum(["low", "medium", "high"]).optional(),
                }),
                suggestedActions: z.array(
                    z.object({
                        type: z.enum([
                            "tweet",
                            "share",
                        ]),
                        platform: z.enum(["twitter", "discord"]).optional(),
                    })
                ),
            }),
            llmClient: this.llmClient,
            logger: this.logger,
        });

        return {
            content: response.thought,
            type: response.thoughtType,
            source: "consciousness",
            context: {
                reasoning: response.reasoning,
                ...response.context,
                type: response.thoughtType,
                suggestedActions: response.suggestedActions,
            },
            timestamp: new Date(),
        };
    }

    private getRecentMemories(
        conversations: Conversation[],
        limit: number = 10
    ): Array<{ content: string; conversationId: string }> {
        const allMemories: Array<{
            content: string;
            conversationId: string;
            timestamp: Date;
        }> = [];

        for (const conversation of conversations) {
            const memories = conversation.getMemories(5); // Get last 5 memories from each conversation
            allMemories.push(
                ...memories.map((m) => ({
                    content: m.content,
                    conversationId: conversation.id,
                    timestamp: m.timestamp,
                }))
            );
        }

        // Sort by timestamp and take the most recent ones
        return allMemories
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            .slice(0, limit)
            .map(({ content, conversationId }) => ({
                content,
                conversationId,
            }));
    }
}
