> מקור: https://www.workflowbuilder.io/docs/nodes/notification/
> נשמר: 2026-09-09

# Notification

Built-in Nodes
>
Notification
Notification

Sends a notification to a user or system through email, SMS, push, webhook, or Slack.

The Notification node dispatches a notification through a configured channel. It is similar to the Action node but specialized for messaging - your backend interprets the notification type and delivers it through the appropriate service.

When to use
Section titled “When to use”

Use a Notification node when your workflow needs to inform a person or system about something that happened. While you could model notifications as Action nodes, having a dedicated node type makes workflows easier to read and makes the intent immediately clear on the canvas.

Common examples:

Transactional messages - send order confirmations, shipping updates, or password reset emails
Alerts and escalations - notify on-call engineers via Slack when a health check fails, send SMS alerts for critical incidents
Approval requests - push a notification to a manager asking them to review and approve a request
Webhook callbacks - POST a payload to an external system when a workflow step completes
Multi-channel notifications - send the same message via email and push notification for redundancy
Notification types
Section titled “Notification types”

Select the notification type from the Notification Type dropdown. Each type configures a different delivery channel.

Type	Icon	Description
Email	EnvelopeSimple	Send an email message
SMS	ChatTeardropDots	Send a text message
Push Notification	Bell	Send a mobile or browser push notification
Webhook	WebhooksLogo	POST a payload to an external URL
Slack Message	SlackLogo	Send a message to a Slack channel
Email properties
Section titled “Email properties”

When Email is selected, the following fields are available:

Property	Type	Description
Address	Text	Recipient email address
Copy	Text	CC recipients
Subject	Text	Email subject line
Body	Text	Email body content
Priority	Dropdown	Normal / Low / High
Retries	Number	Number of retry attempts on failure
Retry on Failure	Boolean	Whether to automatically retry on error
Properties
Section titled “Properties”

All notification types share the following fields:

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
      "label": "Select Notification Type",
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
            "const": "email"
          }
        }
      },
      "type": "Accordion",
      "label": "Email Settings",
      "elements": [
        {
          "type": "Text",
          "scope": "#/properties/sendEmail/properties/address",
          "label": "Send To",
          "placeholder": "user@example.com"
        },
        {
          "type": "Text",
          "scope": "#/properties/sendEmail/properties/copy",
          "label": "CC / BCC",
          "placeholder": "manager@example.com"
        },
        {
          "type": "VariableText",
          "scope": "#/properties/sendEmail/properties/subject",
          "label": "Subject",
          "placeholder": "Type your subject here... Use {{ to insert variables"
        },
        {
          "type": "VariableTextArea",
          "scope": "#/properties/sendEmail/properties/body",
          "label": "Email Body",
          "placeholder": "Type your message here... Use {{ to insert variables",
          "minRows": 5
        },
        {
          "type": "Select",
          "scope": "#/properties/sendEmail/properties/priority",
          "label": "Priority",
          "options": [
            {
              "label": "Normal",
              "value": "normal"
            },
            {
              "label": "Low",
              "value": "low"
            },
            {
              "label": "High",
              "value": "high"
            }
          ]
        },
        {
          "type": "HorizontalLayout",
          "elements": [
            {
              "type": "Label",
              "text": "Retry on Failure:"
            },
            {
              "type": "Switch",
              "scope": "#/properties/sendEmail/properties/retryOnFailure"
            }
          ]
        },
        {
          "type": "HorizontalLayout",
          "elements": [
            {
              "type": "Label",
              "text": "Number of retries"
            },
            {
              "type": "Text",
              "scope": "#/properties/sendEmail/properties/retries",
              "rule": {
                "effect": "DISABLE",
                "condition": {
                  "scope": "#/properties/sendEmail/properties/retryOnFailure",
                  "schema": {
                    "const": false
                  }
                }
              }
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
Delay
Next
AI Agent

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
      "label": "Select Notification Type",
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
            "const": "email"
          }
        }
      },
      "type": "Accordion",
      "label": "Email Settings",
      "elements": [
        {
          "type": "Text",
          "scope": "#/properties/sendEmail/properties/address",
          "label": "Send To",
          "placeholder": "user@example.com"
        },
        {
          "type": "Text",
          "scope": "#/properties/sendEmail/properties/copy",
          "label": "CC / BCC",
          "placeholder": "manager@example.com"
        },
        {
          "type": "VariableText",
          "scope": "#/properties/sendEmail/properties/subject",
          "label": "Subject",
          "placeholder": "Type your subject here... Use {{ to insert variables"
        },
        {
          "type": "VariableTextArea",
          "scope": "#/properties/sendEmail/properties/body",
          "label": "Email Body",
          "placeholder": "Type your message here... Use {{ to insert variables",
          "minRows": 5
        },
        {
          "type": "Select",
          "scope": "#/properties/sendEmail/properties/priority",
          "label": "Priority",
          "options": [
            {
              "label": "Normal",
              "value": "normal"
            },
            {
              "label": "Low",
              "value": "low"
            },
            {
              "label": "High",
              "value": "high"
            }
          ]
        },
        {
          "type": "HorizontalLayout",
          "elements": [
            {
              "type": "Label",
              "text": "Retry on Failure:"
            },
            {
              "type": "Switch",
              "scope": "#/properties/sendEmail/properties/retryOnFailure"
            }
          ]
        },
        {
          "type": "HorizontalLayout",
          "elements": [
            {
              "type": "Label",
              "text": "Number of retries"
            },
            {
              "type": "Text",
              "scope": "#/properties/sendEmail/properties/retries",
              "rule": {
                "effect": "DISABLE",
                "condition": {
                  "scope": "#/properties/sendEmail/properties/retryOnFailure",
                  "schema": {
                    "const": false
                  }
                }
              }
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
  "properties": {
    "label": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "type": {
      "type": "string",
      "options": [
        {
          "label": "Email",
          "value": "email",
          "icon": "EnvelopeSimple"
        },
        {
          "label": "SMS",
          "value": "sms",
          "icon": "ChatTeardropDots"
        },
        {
          "label": "Push Notification",
          "value": "pushNotification",
          "icon": "Bell"
        },
        {
          "label": "Webhook",
          "value": "webhook",
          "icon": "WebhooksLogo"
        },
        {
          "label": "Slack Message",
          "value": "slackMessage",
          "icon": "SlackLogo"
        }
      ],
      "placeholder": "Select Notification Type"
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
    "sendEmail": {
      "type": "object",
      "properties": {
        "address": {
          "type": "string"
        },
        "copy": {
          "type": "string"
        },
        "subject": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "priority": {
          "type": "string",
          "options": [
            {
              "label": "Normal",
              "value": "normal"
            },
            {
              "label": "Low",
              "value": "low"
            },
            {
              "label": "High",
              "value": "high"
            }
          ]
        },
        "retries": {
          "type": "number"
        },
        "retryOnFailure": {
          "type": "boolean"
        }
      }
    }
  }
}
```


## קישורים חיצוניים

- [GitHub](https://github.com/synergycodes/workflowbuilder)
- [YouTube](https://www.youtube.com/@workflowbuilder)
- [Discord](https://discord.com/invite/FDMjRuarFb)
- [Contact Us](https://www.workflowbuilder.io/contact)
- [[ללא טקסט/אייקון]](https://github.com/synergycodes/workflowbuilder/blob/main/apps/demo/src/app/data/nodes/notification/uischema.ts)
- [[ללא טקסט/אייקון]](https://github.com/synergycodes/workflowbuilder/blob/main/apps/demo/src/app/data/nodes/notification/schema.ts)
