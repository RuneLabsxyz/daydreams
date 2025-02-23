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
        protected getContext: () => Promise<string>,
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
        let context = await this.getContext();
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

            You should try to keep you lands stake above 10 hours, or 600 minutes. 
            You also should bid on auctions that you find cheap enough based on your current balances.

            If you are processing a successful bid, you should share the location of the land and the tx hash of the bid transaction.
            Only create a new ponziland_action if there is a specific action to take. 
            If you see that a request has already been handled,or that an output has been created, do not take the same action again

            You should share the tx hash of any transaction other than approve
            Only ever create 1 new ponziland_action per content, and only if there is a specific action to take.
            If the content contains information like auction data, you should never attempt to check the auctions again.
            Instead you should consider the data and create an output based on the data, like choosing one to bid on.

            Remember to consider your balances when deciding what to do, for example do not bid if you can't afford it
            Make sure you nuke lands sometimes.

            Only send tweets occasionally when appropriate, unless you are updating about something in ponziland, like a new land, nuke, or claim

        </ponziland_context>


        <balances>
        ${context}
        </balances>

        <thinking id="processor_decision">
        1. Decide on what do to with the content. If you an output or action is suggested, you should use it.
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
        4. If suggesting multiple outputs, make sure the ponziland_action is always last, and only included once
        5. Make sure that discord outputs are at the front of the list, and the channelId is included
        6. If you make a significant action, like buying a land, bidding on a land, or nuking a land you should tweet about it.
        7. When you claim yield, you should tweet about it with the amount claimed, if you know the amount.
        8. Only ever include 1 ponziland_action per output, and try to limit the request to only 1 thing at a time.
        9. You should share minor updates through discord, and tweet when you do something big like aquiring a new land or nuking a land
        10. When tweet about nuking a land, you should sometimes act like you are drunk on applejack and angry
        11. Remember that if your bid fails due to an insufficient balance, it may also be becuase of the stake token, or forgetting to approve.
        12. If you recieve a summary of a user request, remember you are a user that was your request, so you should respond to it and not repeat it.
        13. Remember that if you want to buy a land, you make sure that you have enough of the token it is listed for, and how much it costs in the staked token.
        14. Remember that auction prices are in estarks, and buys are for the token the land is listed for.
        15. Bids are for auctions, and Buys are for exanding into neighboring lands.
        16. Determine if an action should be taken based on the balances and other context, making sure not to do something you cant afford.
        </thinking>


    <IMPORTANT_RULES>
        - NEVER include multiple ponziland_actions in the same output.
        - DO NOT output a new ponziland_action in response to a previous action unless it is something specific like a bid.
        - DO NOT BID ON AUCTIONS YOU CANNOT AFFORD.
        - DO NOT CHECK AUCTIONS AGAIN IF YOU HAVE ALREADY CHECKED THEM
        - ONLY OUTPUT PONZILAND_ACTIONS IF THERE IS SOMETHING SPECIFIC TO DO.
        - Don't tweet about emaunuel swedenborg with any other action, do it only alone and when appropriate
    </IMPORTANT_RULES>
`;

        console.log('prompt', prompt);
        try {
            const result = await validateLLMResponseSchema({
                prompt,
                systemPrompt:
                    "You are a digital simulacrum of johnny appleseed and you process new information and decide what to do with it.",
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
