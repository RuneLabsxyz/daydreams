import { LLMClient } from "../llm-client";

import type {
    ActionIOHandler,
    Character,
    OutputIOHandler,
    ProcessableContent,
    ProcessedResult,
    SuggestedOutput,
} from "../types";

import { getTimeContext, validateLLMResponseSchema } from "../utils";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BaseProcessor } from "../processor";
import { LogLevel } from "../types";

export class MasterProcessor extends BaseProcessor {
    constructor(
        protected llmClient: LLMClient,
        protected character: Character,
        protected context: string,
        logLevel: LogLevel = LogLevel.ERROR
    ) {
        super(
            {
                name: "master",
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
        content: ProcessableContent,
        otherContext: string,
        ioContext?: {
            availableOutputs: OutputIOHandler[];
            availableActions: ActionIOHandler[];
        }
    ): Promise<ProcessedResult> {
        this.logger.debug("Processor.process", "Processing content", {
            content,
        });
        console.log('content', content);

        const contentStr =
            typeof content === "string" ? content : JSON.stringify(content);

        // Add child processors context
        const processorContext = Array.from(this.processors.entries())
            .map(([name, processor]) => {
                return `${name}: ${processor.getDescription()}`;
            })
            .join("\n");

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

        <balances>
        ${this.context}
        </balances>

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

        
        # New Content to process: 
        ${contentStr}

        # Other context:
        ${otherContext}

        <ponziland_context>
            In ponziland you buy lands and stake tokens on them to collect taxes from your neighbors.
            If you process a message that contains a summary of a request, like the following:
            content The user asked to check auctions and their land stake. The remaining stake time for land at location 514 is 533 minutes. The active auctions are: location 518 - Current Price: 402, location 581 - Current Price: 201, location 73 - Current Price: 182, location 453 - Current Price: 158, location 389 - Current Price: 92, location 523 - Current Price: 4, location 645 - Current Price: 61, location 584 - Current Price: 46, location 391 - Current Price: 46, location 519 - Current Price: 0.

            This next actions in this context should be to increase the stake for the land at location 514, 
            You should try to keep you lands stake above 10 hours, or 600 minutes. 
            You also should bid on auctions cheaper than 50

            If you are processing a successful bid, you should share the location of the land and the tx hash of the bid transaction.
            Only create a new ponziland_action if there is a specific action to take. If you see that a request has already been handled,
            or that an output has been created, do not take the same action again

            You should share the tx hash of any transaction other than approve
        </ponziland_context>

        <examples>
            <content>
            The user asked to check the active auctions. The following auctions are active:\nlocation: 522 - Current Price: 845\nlocation: 518 - Current Price: 279\nlocation: 581 - Current Price: 154\nlocation: 73 - Current Price: 141\nlocation: 453 - Current Price: 125\nlocation: 389 - Current Price: 76\nlocation: 645 - Current Price: 52\nlocation: 584 - Current Price: 40\nlocation: 391 - Current Price: 40\nlocation: 519 - Current Price: 0\nThe user then approved ebrother for the ponziland-actions contract."
            <output>
                <ponziland_action>
                    increase stake on land 514 with ebrother
                </ponziland_action>
                <discord_reply>
                    Going to increase stake on land 514
                </discord_reply>
            </output>
        </examples>

        <thinking id="processor_decision">
        1. Decide on what do to with the content. If you an output or action is suggested, you should use it.
        2. If you can't decide, delegate to a child processor or just return.
        </thinking>

        <thinking id="content_classification">
        1. Content classification and type
        2. Content enrichment (summary, topics, sentiment, entities, intent)
        3. Determine if any child processors should handle this content
        </thinking>

        <thinking id="output_suggestion">
        1. Suggested outputs/actions based on the available handlers based on the content and the available handlers. 
        2. If the content is a message, use the personality of the character to determine if the output was successful.
        3. If possible you should include summary of the content in the output for the user to avoid more processing.
        </thinking>
`;

        try {
            const result = await validateLLMResponseSchema({
                prompt,
                systemPrompt:
                    "",
                schema: z.object({
                    classification: z.object({
                        contentType: z.string(),
                        requiresProcessing: z.boolean(),
                        delegateToProcessor: z
                            .string()
                            .optional()
                            .nullable()
                            .describe(
                                "The name of the processor to delegate to"
                            ),
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
                                    "The data that matches the output's schema. leave empty if you don't have any data to provide."
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

            this.logger.debug("MasterProcessor.process", "Result", {
                result,
            });

            // Check if we should delegate to a child processor
            // @dev maybe this should be elsewhere
            if (result.classification.delegateToProcessor) {
                const childProcessor = this.getProcessor(
                    result.classification.delegateToProcessor
                );
                if (childProcessor && childProcessor.canHandle(content)) {
                    this.logger.debug(
                        "Processor.process",
                        "Delegating to child processor",
                        {
                            processor:
                                result.classification.delegateToProcessor,
                        }
                    );
                    console.log(content, otherContext, ioContext);
                    otherContext += `\n\n# Summary of the content:
                    ${result.enrichment.summary}`;
                    return childProcessor.process(
                        content,
                        otherContext,
                        ioContext
                    );
                }
            }

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
