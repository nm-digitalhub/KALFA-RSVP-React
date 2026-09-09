> מקור: https://www.workflowbuilder.io/docs/nodes/delay/
> נשמר: 2026-09-09

# Delay

Built-in Nodes
>
Delay
Delay

Pauses the workflow for a specified duration before continuing to the next step.

The Delay node pauses workflow execution for a configured amount of time before proceeding to the next connected node. The pause duration can be fixed, computed dynamically, or based on a condition.

When to use
Section titled “When to use”

Use a Delay node whenever your workflow needs to wait before continuing. Delays are essential for building workflows that operate on real-world timelines rather than executing everything instantly.

Common examples:

Follow-up sequences - wait 24 hours after a customer signs up before sending a welcome email, then wait 3 days before sending a feature highlight
Rate limiting - pause between API calls to respect third-party rate limits
Cool-down periods - enforce a waiting period between retries or repeated actions (e.g., wait 15 minutes before retrying a failed payment)
SLA timers - wait until a deadline, then escalate if the task is still unresolved
Batch processing - collect events over a time window, then process them together
Delay types
Section titled “Delay types”

Select the delay type from the Delay Type dropdown. Each type reveals different configuration fields.

Fixed Delay
Section titled “Fixed Delay”

Pauses for a specific amount of time.

Property	Type	Description
Delay Amount	Number	How long to wait
Time Units	Dropdown	None / Minutes / Hours
Dynamic Delay
Section titled “Dynamic Delay”

Computes the delay duration from an expression at runtime.

Property	Type	Description
Expression	Text	Expression that evaluates to a duration (e.g., order.processing_time * 2)
Max Wait Time	Dropdown	2 hours / 4 hours / 8 hours / 12 hours / 24 hours
Conditional Delay
Section titled “Conditional Delay”

Waits until a condition is met or a maximum wait time is reached.

Property	Type	Description
Max Wait Time	Dropdown	2 hours / 4 hours / 8 hours / 12 hours / 24 hours
Until Specific Date/Time
Section titled “Until Specific Date/Time”

Pauses until a specific date and time.

Property	Type	Description
Max Wait Time	Dropdown	2 hours / 4 hours / 8 hours / 12 hours / 24 hours
Properties
Section titled “Properties”

All delay types share the following fields:

Property	Type	Description
Label	Text	Display name shown on the node card
Description	Text	Short description of the node’s purpose
Status	Dropdown	Active / Draft / Disabled
Schemas
UI Schema
Data Schema
{
  "type": "VerticalLayout",
  "elements": [
    {
      "type": "MessageOnError",
      "scope": "#/properties/missingPreviousVariable",
      "text": "plugins.validation.missingDependency"
    },
    {
      "label": "Delay Type",
      "type": "Select",
      "scope": "#/properties/type"
    },
    {
      "type": "Accordion",
      "label": "General Information",
      "rule": {
        "effect": "SHOW",
        "condition": {
          "scope": "#",
          "schema": {
            "required": [
              "type"
            ]
          }
        }
      },
      "elements": [
        {
          "type": "Text",
          "scope": "#/properties/label",
          "label": "Title",
          "placeholder": "Node Title..."
        },
        {
          "type": "Select",
          "scope": "#/properties/status",
          "options": [
            {
              "label": "Active",
              "value": "active",
              "icon": "StatusActive"
            },
            {
              "label": "Draft",
              "value": "draft",
              "icon": "StatusDraft"
            },
            {
              "label": "Disabled",
              "value": "disabled",
              "icon": "StatusDisabled"
            }
          ],
          "label": "Status"
        },
        {
          "type": "Text",
          "scope": "#/properties/description",
          "label": "Description",
          "placeholder": "Type your description here..."
        }
      ]
    },
    {
      "rule": {
        "effect": "SHOW",
        "condition": {
          "scope": "#/properties/type",
          "schema": {
            "const": "fixedDelay"
          }
        }
      },
      "type": "Accordion",
      "label": "Duration",
      "elements": [
        {
          "type": "VerticalLayout",
          "elements": [
            {
              "type": "HorizontalLayout",
              "elements": [
                {
                  "type": "Label",
                  "text": "Time Units:"
                },
                {
                  "type": "Select",
                  "scope": "#/properties/duration/properties/timeUnits"
                }
              ]
            },
            {
              "type": "HorizontalLayout",
              "elements": [
                {
                  "type": "Label",
                  "text": "Delay Amount:",
                  "required": true
                },
                {
                  "type": "Text",
                  "scope": "#/properties/duration/properties/delayAmount",
                  "errorIndicatorEnabled": false
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "rule": {
        "effect": "SHOW",
        "condition": {
          "scope": "#/properties/type",
          "schema": {
            "const": "dynamicDelay"
          }
        }
      },
      "type": "Accordion",
      "label": "Duration",
      "elements": [
        {
          "type": "VerticalLayout",
          "elements": [
            {
              "type": "Text",
              "scope": "#/properties/duration/properties/expression",
              "label": "Duration Expression"
            },
            {
              "type": "HorizontalLayout",
              "elements": [
                {
                  "type": "Label",
                  "text": "Max Wait Time:"
                },
                {
                  "type": "Select",
                  "scope": "#/properties/duration/properties/maxWaitTime"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}

Customizable

This node type ships ready to use with the configuration shown above. Every property, icon, and UI element is schema-driven - you can adapt it to your domain or use it as a starting point for a custom node type.
See also
Section titled “See also”
Add Custom Node Type - register a new node type with custom properties
Flow Runner plugin - turn a diagram into an executable flow function
Trigger node - start a flow in response to an event or schedule
Previous
Decision
Next
Notification

## בלוקי קוד

```
{
  "type": "VerticalLayout",
  "elements": [
    {
      "type": "MessageOnError",
      "scope": "#/properties/missingPreviousVariable",
      "text": "plugins.validation.missingDependency"
    },
    {
      "label": "Delay Type",
      "type": "Select",
      "scope": "#/properties/type"
    },
    {
      "type": "Accordion",
      "label": "General Information",
      "rule": {
        "effect": "SHOW",
        "condition": {
          "scope": "#",
          "schema": {
            "required": [
              "type"
            ]
          }
        }
      },
      "elements": [
        {
          "type": "Text",
          "scope": "#/properties/label",
          "label": "Title",
          "placeholder": "Node Title..."
        },
        {
          "type": "Select",
          "scope": "#/properties/status",
          "options": [
            {
              "label": "Active",
              "value": "active",
              "icon": "StatusActive"
            },
            {
              "label": "Draft",
              "value": "draft",
              "icon": "StatusDraft"
            },
            {
              "label": "Disabled",
              "value": "disabled",
              "icon": "StatusDisabled"
            }
          ],
          "label": "Status"
        },
        {
          "type": "Text",
          "scope": "#/properties/description",
          "label": "Description",
          "placeholder": "Type your description here..."
        }
      ]
    },
    {
      "rule": {
        "effect": "SHOW",
        "condition": {
          "scope": "#/properties/type",
          "schema": {
            "const": "fixedDelay"
          }
        }
      },
      "type": "Accordion",
      "label": "Duration",
      "elements": [
        {
          "type": "VerticalLayout",
          "elements": [
            {
              "type": "HorizontalLayout",
              "elements": [
                {
                  "type": "Label",
                  "text": "Time Units:"
                },
                {
                  "type": "Select",
                  "scope": "#/properties/duration/properties/timeUnits"
                }
              ]
            },
            {
              "type": "HorizontalLayout",
              "elements": [
                {
                  "type": "Label",
                  "text": "Delay Amount:",
                  "required": true
                },
                {
                  "type": "Text",
                  "scope": "#/properties/duration/properties/delayAmount",
                  "errorIndicatorEnabled": false
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "rule": {
        "effect": "SHOW",
        "condition": {
          "scope": "#/properties/type",
          "schema": {
            "const": "dynamicDelay"
          }
        }
      },
      "type": "Accordion",
      "label": "Duration",
      "elements": [
        {
          "type": "VerticalLayout",
          "elements": [
            {
              "type": "Text",
              "scope": "#/properties/duration/properties/expression",
              "label": "Duration Expression"
            },
            {
              "type": "HorizontalLayout",
              "elements": [
                {
                  "type": "Label",
                  "text": "Max Wait Time:"
                },
                {
                  "type": "Select",
                  "scope": "#/properties/duration/properties/maxWaitTime"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

```
{
  "required": [
    "label",
    "description",
    "type",
    "status"
  ],
  "type": "object",
  "properties": {
    "label": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "type": {
      "type": "string",
      "placeholder": "Select Delay Type...",
      "options": [
        {
          "label": "Fixed Delay",
          "value": "fixedDelay",
          "icon": "Clock"
        },
        {
          "label": "Dynamic Delay",
          "value": "dynamicDelay",
          "icon": "HourglassSimpleHigh"
        },
        {
          "label": "Conditional Delay",
          "value": "conditionalDelay",
          "icon": "ListChecks"
        },
        {
          "label": "Until Specific Date/Time",
          "value": "untilSpecificDateTime",
          "icon": "CalendarDot"
        }
      ]
    },
    "status": {
      "type": "string",
      "options": [
        {
          "label": "Active",
          "value": "active",
          "icon": "StatusActive"
        },
        {
          "label": "Draft",
          "value": "draft",
          "icon": "StatusDraft"
        },
        {
          "label": "Disabled",
          "value": "disabled",
          "icon": "StatusDisabled"
        }
      ]
    },
    "duration": {
      "type": "object",
      "properties": {
        "timeUnits": {
          "type": "string",
          "options": [
            {
              "label": "None",
              "value": "none"
            },
            {
              "label": "Minutes",
              "value": "minutes"
            },
            {
              "label": "Hours",
              "value": "hours"
            }
          ]
        },
        "delayAmount": {
          "type": "number"
        },
        "expression": {
          "type": "string"
        },
        "maxWaitTime": {
          "type": "string",
          "options": [
            {
              "label": "24 hours",
              "value": "24"
            },
            {
              "label": "12 hours",
              "value": "12"
            },
            {
              "label": "8 hours",
              "value": "8"
            },
            {
              "label": "4 hours",
              "value": "4"
            },
            {
              "label": "2 hours",
              "value": "2"
            }
          ]
        }
      }
    }
  },
  "allOf": [
    {
      "if": {
        "properties": {
          "type": {
            "const": "fixedDelay"
          }
        }
      },
      "then": {
        "properties": {
          "duration": {
            "type": "object",
            "required": [
              "delayAmount"
            ],
            "properties": {
              "delayAmount": {
                "type": "number",
                "minimum": 1
              }
            }
          }
        }
      }
    }
  ]
}
```


## קישורים חיצוניים

- [GitHub](https://github.com/synergycodes/workflowbuilder)
- [YouTube](https://www.youtube.com/@workflowbuilder)
- [Discord](https://discord.com/invite/FDMjRuarFb)
- [Contact Us](https://www.workflowbuilder.io/contact)
- [[ללא טקסט/אייקון]](https://github.com/synergycodes/workflowbuilder/blob/main/apps/demo/src/app/data/nodes/delay/uischema.ts)
- [[ללא טקסט/אייקון]](https://github.com/synergycodes/workflowbuilder/blob/main/apps/demo/src/app/data/nodes/delay/schema.ts)
