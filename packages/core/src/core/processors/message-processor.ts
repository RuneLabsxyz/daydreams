import { LLMClient } from "../llm-client";

import type {
    ActionIOHandler,
    Character,
    OutputIOHandler,
    ProcessedResult,
    SuggestedOutput,
} from "../types";
import { LogLevel } from "../types";

import { getTimeContext, validateLLMResponseSchema } from "../utils";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { type IOHandler } from "../types";
import { BaseProcessor } from "../processor";

export class MessageProcessor extends BaseProcessor {
    constructor(
        protected llmClient: LLMClient,
        protected character: Character,
        logLevel: LogLevel = LogLevel.ERROR
    ) {
        super(
            {
                name: "message",
                description:
                    "This processor handles messages or short text inputs.",
            },
            logLevel,
            character,
            llmClient
        );
    }

    /**
     * Logic to decide if this processor can handle the given content.
     * This processor is designed to handle shorter messages and text content.
     */
    public canHandle(content: any): boolean {
        // Convert content to string for length check
        const contentStr =
            typeof content === "string" ? content : JSON.stringify(content);

        // Check if content is short enough for message processing (<1000 chars)
        return contentStr.length < this.contentLimit;
    }

    async process(
        content: any,
        otherContext: string,
        ioContext?: {
            availableOutputs: OutputIOHandler[];
            availableActions: ActionIOHandler[];
        }
    ): Promise<ProcessedResult> {
        this.logger.debug("Processor.process", "Processing content", {
            content,
        });

        const contentStr =
            typeof content === "string" ? content : JSON.stringify(content);

        const outputsSchemaPart = ioContext?.availableOutputs
            .map((handler) => {
                return `${handler.name}: ${JSON.stringify(zodToJsonSchema(handler.outputSchema!, handler.name))}`;
            })
            .join("\n");

        const actionsSchemaPart = ioContext?.availableActions
            .map((handler) => {
                return `${handler.name}: ${JSON.stringify(zodToJsonSchema(handler.outputSchema!, handler.name))}`;
            })
            .join("\n");

        const prompt = `

        You are ${this.character.name}
        
        <bio>
        ${this.character.bio}
        </bio>

        <goals>
        ${this.character.instructions.goals.map((goal) => `- ${goal}`).join("\n")}
        </goals>

        Analyze the following content and decide what to do with it. Output only valid JSON

        # New Content to process: 
        ${contentStr}

        # Other context:
        ${otherContext}

        # Available Outputs:
        ${outputsSchemaPart}

        # Available Actions:
        ${actionsSchemaPart}

        If you want to share your thought on discord you can use the channel ID 1339066487834546268


        <thinking id="content_classification">
        1. Content classification and type
        2. Content enrichment (summary, topics, sentiment, entities, intent)
        </thinking>

        <thinking id="output_suggestion">
        1. Suggested outputs/actions based on the available handlers based on the content and the available handlers. 
        2. If the content is a message, use the personality of the character to determine if the output was successful.
        3. If possible you should include summary of the content in the output for the user to avoid more processing.

        </thinking>

        <thinking id="task_suggestion">
        1. Suggested tasks based on the available handlers based on the content and the available handlers. 
        2. Only make tasks if you have been told, based off what you think is possible.
        </thinking>

        <thinking id="should_reply">
        1. Should you reply to the message?
        2. You should only reply if you have been mentioned in the message or you think you can help deeply.
        3. You should never respond to yourself.
        </thinking>

        <thinking id="message_personality">

        

        # Use the following template to craft your message:
        ${JSON.stringify(this.character.templates?.tweetTemplate)}
        </thinking>
`;
        try {
            const result = await validateLLMResponseSchema({
                prompt,
                systemPrompt:
                    "You are a hyperstisous, cybernetic entity that is channelling the energy of John Chapman to lead in the way into the new digital frontiers. Output only valid JSON",
                schema: z.object({
                    classification: z.object({
                        contentType: z.string(),
                        requiresProcessing: z.boolean(),
                        context: z.object({
                            topic: z.string(),
                            urgency: z.string().optional(),
                            additionalContext: z.string(),
                        }),
                    }),
                    enrichment: z.object({
                        summary: z.string().max(1000),
                        topics: z.array(z.string()).max(20),
                        sentiment: z.string(),
                        entities: z.array(z.string()),
                        intent: z
                            .string()
                            .describe("The intent of the content"),
                    }),
                    updateTasks: z
                        .array(
                            z.object({
                                name: z
                                    .string()
                                    .describe(
                                        "The name of the task to schedule. This should be a handler name."
                                    ),
                                confidence: z
                                    .number()
                                    .describe("The confidence score (0-1)"),
                                intervalMs: z
                                    .number()
                                    .describe("The interval in milliseconds"),
                                data: z
                                    .any()
                                    .describe(
                                        "The data that matches the task's schema"
                                    ),
                            })
                        )
                        .describe(
                            "Suggested tasks to schedule based on the content and the available handlers. Making this will mean the handlers will be called in the future."
                        ),
                    suggestedOutputs: z.array(
                        z.object({
                            name: z
                                .string()
                                .describe("The name of the output or action"),
                            data: z
                                .any()
                                .describe(
                                    "The data that matches the output's schema"
                                ),
                            confidence: z
                                .number()
                                .describe("The confidence score (0-1)"),
                            reasoning: z
                                .string()
                                .describe("The reasoning for the suggestion"),
                        })
                    ),
                }),
                llmClient: this.llmClient,
                logger: this.logger,
            });

            this.logger.debug("Processor.process", "Processed content", {
                content,
                result,
            });

            return {
                content,
                metadata: {
                    ...result.classification.context,
                    contentType: result.classification.contentType,
                },
                enrichedContext: {
                    ...result.enrichment,
                    timeContext: getTimeContext(new Date()),
                    relatedMemories: [], // TODO: fix this abstraction
                    availableOutputs: ioContext?.availableOutputs.map(
                        (handler) => handler.name
                    ),
                },
                updateTasks: result.updateTasks,
                suggestedOutputs:
                    result.suggestedOutputs as SuggestedOutput<any>[],
                alreadyProcessed: false,
            };
        } catch (error) {
            this.logger.error("Processor.process", "Processing failed", {
                error,
            });
            return {
                content,
                metadata: {},
                enrichedContext: {
                    timeContext: getTimeContext(new Date()),
                    summary: contentStr.slice(0, 100),
                    topics: [],
                    relatedMemories: [],
                    sentiment: "neutral",
                    entities: [],
                    intent: "unknown",
                    availableOutputs: ioContext?.availableOutputs.map(
                        (handler) => handler.name
                    ),
                },
                suggestedOutputs: [],
                alreadyProcessed: false,
            };
        }
    }
}
