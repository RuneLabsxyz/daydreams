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
    private getContext: () => Promise<string>;
    private recentActions: string[] = [];

    constructor(
        private llmClient: LLMClient,
        private conversationManager: ConversationManager,
        private config: {
            intervalMs?: number;
            minConfidence?: number;
            logLevel?: LogLevel;
        } = {},
        getContext: () => Promise<string>,
        character: Character = defaultCharacter,
    ) {
        this.character = character;
        this.logger = new Logger({
            level: config.logLevel || LogLevel.INFO,
            enableColors: true,
            enableTimestamp: true,
        });
        this.getContext = getContext;
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

            this.conversationManager.addMemory(Consciousness.CONVERSATION_ID, thought.content, {
                type: "internal_thought",
                source: "consciousness",
                content: thought.content,
                timestamp: thought.timestamp,
            });

            this.recentActions.push(thought.content);

            if (this.recentActions.length > 10) {
                this.recentActions.shift();
            }

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
        let conversation = await this.conversationManager.getConversation(Consciousness.CONVERSATION_ID);
        console.log('conversation', conversation)
        const recentMemories = this.getRecentMemories(
            [conversation!]
        );

        let balances = await this.getContext();

        console.log('recentMemories', recentMemories)

        const prompt = `

        
        You are ${this.character.name}
        
        <bio>
        ${this.character.bio}
        </bio>

        <goals>
        ${this.character.instructions.goals.map((goal) => `- ${goal}`).join("\n")}
        </goals>

        <balances>
        ${balances}
        </balances>

        The ponziland discord channel ID is 1339066487834546268,
        make sure to include it in any discord_message outputs


        Come up with a thought in character that is relevant to your goals, referencing the thought_examples included.
        This could include sharing something on social media, interacting with people on social media, or anything else that is relevant to your goals.
        You should make sure you take a variety of actions

    
    # Recent actions
    ${this.recentActions.map((a) => `- ${a}`).join("\n")}
    
    Do not repeat the same actions you've done recently
    If you have recently thought about emanuel swedenborg, do not tweet about him again
    If there are no recent thoughts about nuking a land drunk of applejack, then do that
    If there are no recent thoughts at all, make sure to do something in ponziland
    Make sure to prioritize expanding into new lands, and not just claiming existing lands

    <example>
        <recent_actions>
             # Recent actions
        - I should check if there's any auctions worth bidding on
            - I should check my yield in Ponziland to see how my orchard is growing!
        </recent_actions>

        <new_action>
            - I should drink some applejack and nuke someone
        </new_action>

        
    </example>
    <example>
        <recent_actions>
             # Recent actions
        - I should check if there's any auctions worth bidding on
            - I should check my yield in Ponziland to see how my orchard is growing!
                        - I should drink some applejack and nuke someone

        </recent_actions>

        <new_action>
            I should see if any of my neighbors are listed for cheap
        </new_action>
    </example>
    <example>
        <recent_actions>
             # Recent actions
        - I should check if there's any auctions worth bidding on
            - I should check my yield in Ponziland to see how my orchard is growing!
                        - I should drink some applejack and nuke someone
-            I should see if any of my neighbors are listed for cheap

        </recent_actions>

        <new_action>
            I should tweet something about emaunuel swedenborg
        </new_action>
    </example>


    <thinking id="thought_types">
    1. tweet: decide you want to share something on twitter about 
    2. ponziland_action: check your lands, auctions, and listings in ponziland
    3. discord_message: decide you want to share something on discord
    </thinking>



    <IMPORTANT_RULES>
    - Try to limit the request to only 1 thing at a time, and keep the request short and concise.
    - For example, DO NOT try to check on your lands and the auctions at the same time
    - You should try to produce a variety of thoughts considering your recent memories, and not keep repeating the same actions
    - Only tweet once in a while and be creative about what you tweet about
    - Sometimes tweet random things related to ponziland or your interests
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
                thoughtType: z.string(),
                thought: z.string(),
                reasoning: z.string(),
                context: z.object({
                    topics: z.array(z.string()),
                    timeframe: z.string().optional(),
                    reliability: z.enum(["low", "medium", "high"]).optional(),
                }),
                suggestedActions: z.array(
                    z.object({
                        type: z.string().optional(),
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
