> מקור: https://www.workflowbuilder.io/docs/nodes/trigger/
> נשמר: 2026-09-09

# Trigger

Built-in Nodes
>
Trigger
Trigger

Starts a workflow in response to an event, a schedule, a condition, or a system signal.

The Trigger node is the entry point of every workflow. It defines when and how a workflow starts. Every workflow must begin with exactly one Trigger node, placed at the start of the diagram.

When to use
Section titled “When to use”

Use a Trigger node to define the starting condition for any workflow. The trigger type determines what kicks off the execution.

Common examples:

Scheduled jobs - run a report every morning, send a digest email every Friday, or archive records at the end of each month
Incoming events - start a workflow when a form is submitted, a record changes, or an API call is received
Data conditions - begin processing when a value crosses a threshold (e.g., “inventory below 10 units”)
System signals - react to internal platform events like a deployment completing or a health check failing
Trigger types
Section titled “Trigger types”

Select the trigger type from the Trigger Type dropdown. Each type reveals its own set of configuration fields.

Time-based Trigger
Section titled “Time-based Trigger”

Starts the workflow on a schedule.

Property	Type	Description
All Day	Boolean	Whether the trigger fires for the full day
Starts	Date + Time	When the schedule begins
Ends	Date + Time	When the schedule ends
Frequency	Dropdown	None / Daily / Weekly / Monthly / Yearly / Custom. When All Day is off, Hourly is also available
Event-based Trigger
Section titled “Event-based Trigger”

Starts the workflow when an external event occurs.

Property	Type	Options
Event Type	Dropdown	Form Submission / Record Change / API Call / User Action
Conditional Trigger
Section titled “Conditional Trigger”

Starts the workflow when a data condition is met.

Property	Type	Description
Rule	Dropdown	Comparison operator (see below)
Value	Text	Value to compare against

Available rules:

Rule	Description
Is Equal To	Exact match
Is Not Equal To	Does not match
Is Greater Than	Numeric greater-than
Is Greater Than or Equal To	Numeric greater-than or equal
Is Less Than	Numeric less-than
Is Less Than or Equal To	Numeric less-than or equal
Contains	Value includes the substring
Does Not Contain	Value excludes the substring
Matches Regex	Value matches the regular expression
Does Not Match Regex	Value does not match the expression
Formula is True	Expression evaluates to true
Formula is False	Expression evaluates to false
System Trigger
Section titled “System Trigger”

Starts the workflow in response to an internal system event.

Property	Type	Description
System Value	Text	Identifier of the system event
Properties
Section titled “Properties”

All trigger types share the following fields:

Property	Type	Description
Label	Text	Display name shown on the node card
Description	Text	Short description of the node’s purpose
Status	Dropdown	Active / Inactive / Draft (or as configured)
Retry settings
Section titled “Retry settings”

Configure how the system handles trigger failures:

Property	Options	Description
Retry Interval	Every 15 min / Every 20 min / Every 30 min	How long to wait before retrying
Max Retries	5 / 10 / 15	Maximum number of retry attempts
Timeout	30 min / 60 min / 90 min	How long before a trigger attempt times out
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
      "label": "Trigger Type",
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
            "const": "timeBasedTrigger"
          }
        }
      },
      "type": "VerticalLayout",
      "elements": [
        {
          "type": "Accordion",
          "label": "Trigger Schedule",
          "elements": [
            {
              "type": "HorizontalLayout",
              "elements": [
                {
                  "type": "Label",
                  "text": "All Day:"
                },
                {
                  "type": "Switch",
                  "scope": "#/properties/timeSchedule/properties/allDay"
                }
              ]
            },
            {
              "type": "HorizontalLayout",
              "layoutColumns": "1fr 110px 60px",
              "elements": [
                {
                  "type": "Label",
                  "text": "Starts"
                },
                {
                  "type": "DatePicker",
                  "scope": "#/properties/timeSchedule/properties/starts/properties/date"
                },
                {
                  "type": "Text",
                  "scope": "#/properties/timeSchedule/properties/starts/properties/time",
                  "placeholder": "--:--",
                  "rule": {
                    "effect": "SHOW",
                    "condition": {
                      "scope": "#/properties/timeSchedule/properties/allDay",
                      "schema": {
                        "const": false
                      }
                    }
                  }
                }
              ]
            },
            {
              "type": "HorizontalLayout",
              "layoutColumns": "1fr 110px 60px",
              "elements": [
                {
                  "type": "Label",
                  "text": "Ends"
                },
                {
                  "type": "DatePicker",
                  "scope": "#/properties/timeSchedule/properties/ends/properties/date"
                },
                {
                  "rule": {
                    "effect": "SHOW",
                    "condition": {
                      "scope": "#/properties/timeSchedule/properties/allDay",
                      "schema": {
                        "const": false
                      }
                    }
                  },
                  "type": "Text",
                  "scope": "#/properties/timeSchedule/properties/ends/properties/time",
                  "placeholder": "--:--"
                }
              ]
            },
            {
              "type": "HorizontalLayout",
              "layoutColumns": "1fr 177px",
              "elements": [
                {
                  "type": "Label",
                  "text": "Frequency"
                },
                {
                  "type": "Select",
                  "scope": "#/properties/timeSchedule/properties/frequency",
                  "options": [
                    {
                      "label": "None",
                      "value": "none"
                    },
                    {
                      "label": "Hourly",
                      "value": "hourly"
                    },
                    {
                      "label": "Daily",
                      "value": "daily"
                    },
                    {
                      "label": "Weekly",
                      "value": "weekly"
                    },
                    {
                      "label": "Monthly",
                      "value": "monthly"
                    },
                    {
                      "label": "Yearly",
                      "value": "yearly"
                    },
                    {
                      "type": "separator"
                    },
                    {
                      "label": "Custom...",
                      "value": "custom"
                    }
                  ],
                  "rule": {
                    "effect": "SHOW",
                    "condition": {
                      "scope": "#/properties/timeSchedule/properties/allDay",
                      "schema": {
                        "const": false
                      }
                    }
                  }
                },
                {
                  "type": "Select",
                  "scope": "#/properties/timeSchedule/properties/allDayFrequency",
                  "options": [
                    {
                      "label": "None",
                      "value": "none"
                    },
                    {
                      "label": "Daily",
                      "value": "daily"
                    },
                    {
                      "label": "Weekly",
                      "value": "weekly"
                    },
                    {
                      "label": "Monthly",
                      "value": "monthly"
                    },
                    {
                      "label": "Yearly",
                      "value": "yearly"
                    },
                    {
                      "label": "Custom...",
                      "value": "custom"
                    }
                  ],
                  "rule": {
                    "effect": "SHOW",
                    "condition": {
                      "scope": "#/properties/timeSchedule/properties/allDay",
                      "schema": {
                        "const": true
                      }
                    }
                  }
                }
              ]
            }
          ]
        },
        {
          "type": "Accordion",
          "label": "Retry Settings",
          "elements": [
            {
              "type": "HorizontalLayout",
              "elements": [
                {
                  "type": "Label",
                  "text": "Retry Interval"
                },
                {
                  "type": "Select",
                  "scope": "#/properties/retrySettings/properties/interval",
                  "options": [
                    {
                      "label": "Every 15 min",
                      "value": "every15min"
                    },
                    {
                      "label": "Every 20 min",
                      "value": "every20min"
                    },
                    {
                      "label": "Every 30 min",
                      "value": "every30min"
                    }
                  ]
                }
              ]
            },
            {
              "type": "HorizontalLayout",
              "elements": [
                {
                  "type": "Label",
                  "text": "Max Retries"
                },
                {
                  "type": "Select",
                  "scope": "#/properties/retrySettings/properties/retries",
                  "options": [
                    {
                      "label": "5",
                      "value": "5"
                    },
                    {
                      "label": "10",
                      "value": "10"
                    },
                    {
                      "label": "15",
                      "value": "15"
                    }
                  ]
                }
              ]
            },
            {
              "type": "HorizontalLayout",
              "elements": [
                {
                  "type": "Label",
                  "text": "Timeout"
                },
                {
                  "type": "Select",
                  "scope": "#/properties/retrySettings/properties/timeout",
                  "options": [
                    {
                      "label": "30 min",
                      "value": "30Min"
                    },
                    {
                      "label": "60 min",
                      "value": "60Min"
                    },
                    {
                      "label": "90 min",
                      "value": "90Min"
                    }
                  ]
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
            "const": "eventBasedTrigger"
          }
        }
      },
      "type": "Accordion",
      "label": "Event-Based Properties",
      "elements": [
        {
          "type": "Select",
          "label": "Event Type",
          "scope": "#/properties/eventType",
          "options": [
            {
              "label": "Form Submission",
              "value": "formSubmission"
            },
            {
              "label": "Record Change",
              "value": "recordChange"
            },
            {
              "label": "API Call",
              "value": "apiCall"
            },
            {
              "label": "User Action",
              "value": "userAction"
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
Notification node - send a notification via email, SMS, push, webhook, or Slack
Delay node - pause a flow for a specified duration before continuing
Previous
Built-in Nodes Overview
Next
Action

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
      "label": "Trigger Type",
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
            "const": "timeBasedTrigger"
          }
        }
      },
      "type": "VerticalLayout",
      "elements": [
        {
          "type": "Accordion",
          "label": "Trigger Schedule",
          "elements": [
            {
              "type": "HorizontalLayout",
              "elements": [
                {
                  "type": "Label",
                  "text": "All Day:"
                },
                {
                  "type": "Switch",
                  "scope": "#/properties/timeSchedule/properties/allDay"
                }
              ]
            },
            {
              "type": "HorizontalLayout",
              "layoutColumns": "1fr 110px 60px",
              "elements": [
                {
                  "type": "Label",
                  "text": "Starts"
                },
                {
                  "type": "DatePicker",
                  "scope": "#/properties/timeSchedule/properties/starts/properties/date"
                },
                {
                  "type": "Text",
                  "scope": "#/properties/timeSchedule/properties/starts/properties/time",
                  "placeholder": "--:--",
                  "rule": {
                    "effect": "SHOW",
                    "condition": {
                      "scope": "#/properties/timeSchedule/properties/allDay",
                      "schema": {
                        "const": false
                      }
                    }
                  }
                }
              ]
            },
            {
              "type": "HorizontalLayout",
              "layoutColumns": "1fr 110px 60px",
              "elements": [
                {
                  "type": "Label",
                  "text": "Ends"
                },
                {
                  "type": "DatePicker",
                  "scope": "#/properties/timeSchedule/properties/ends/properties/date"
                },
                {
                  "rule": {
                    "effect": "SHOW",
                    "condition": {
                      "scope": "#/properties/timeSchedule/properties/allDay",
                      "schema": {
                        "const": false
                      }
                    }
                  },
                  "type": "Text",
                  "scope": "#/properties/timeSchedule/properties/ends/properties/time",
                  "placeholder": "--:--"
                }
              ]
            },
            {
              "type": "HorizontalLayout",
              "layoutColumns": "1fr 177px",
              "elements": [
                {
                  "type": "Label",
                  "text": "Frequency"
                },
                {
                  "type": "Select",
                  "scope": "#/properties/timeSchedule/properties/frequency",
                  "options": [
                    {
                      "label": "None",
                      "value": "none"
                    },
                    {
                      "label": "Hourly",
                      "value": "hourly"
                    },
                    {
                      "label": "Daily",
                      "value": "daily"
                    },
                    {
                      "label": "Weekly",
                      "value": "weekly"
                    },
                    {
                      "label": "Monthly",
                      "value": "monthly"
                    },
                    {
                      "label": "Yearly",
                      "value": "yearly"
                    },
                    {
                      "type": "separator"
                    },
                    {
                      "label": "Custom...",
                      "value": "custom"
                    }
                  ],
                  "rule": {
                    "effect": "SHOW",
                    "condition": {
                      "scope": "#/properties/timeSchedule/properties/allDay",
                      "schema": {
                        "const": false
                      }
                    }
                  }
                },
                {
                  "type": "Select",
                  "scope": "#/properties/timeSchedule/properties/allDayFrequency",
                  "options": [
                    {
                      "label": "None",
                      "value": "none"
                    },
                    {
                      "label": "Daily",
                      "value": "daily"
                    },
                    {
                      "label": "Weekly",
                      "value": "weekly"
                    },
                    {
                      "label": "Monthly",
                      "value": "monthly"
                    },
                    {
                      "label": "Yearly",
                      "value": "yearly"
                    },
                    {
                      "label": "Custom...",
                      "value": "custom"
                    }
                  ],
                  "rule": {
                    "effect": "SHOW",
                    "condition": {
                      "scope": "#/properties/timeSchedule/properties/allDay",
                      "schema": {
                        "const": true
                      }
                    }
                  }
                }
              ]
            }
          ]
        },
        {
          "type": "Accordion",
          "label": "Retry Settings",
          "elements": [
            {
              "type": "HorizontalLayout",
              "elements": [
                {
                  "type": "Label",
                  "text": "Retry Interval"
                },
                {
                  "type": "Select",
                  "scope": "#/properties/retrySettings/properties/interval",
                  "options": [
                    {
                      "label": "Every 15 min",
                      "value": "every15min"
                    },
                    {
                      "label": "Every 20 min",
                      "value": "every20min"
                    },
                    {
                      "label": "Every 30 min",
                      "value": "every30min"
                    }
                  ]
                }
              ]
            },
            {
              "type": "HorizontalLayout",
              "elements": [
                {
                  "type": "Label",
                  "text": "Max Retries"
                },
                {
                  "type": "Select",
                  "scope": "#/properties/retrySettings/properties/retries",
                  "options": [
                    {
                      "label": "5",
                      "value": "5"
                    },
                    {
                      "label": "10",
                      "value": "10"
                    },
                    {
                      "label": "15",
                      "value": "15"
                    }
                  ]
                }
              ]
            },
            {
              "type": "HorizontalLayout",
              "elements": [
                {
                  "type": "Label",
                  "text": "Timeout"
                },
                {
                  "type": "Select",
                  "scope": "#/properties/retrySettings/properties/timeout",
                  "options": [
                    {
                      "label": "30 min",
                      "value": "30Min"
                    },
                    {
                      "label": "60 min",
                      "value": "60Min"
                    },
                    {
                      "label": "90 min",
                      "value": "90Min"
                    }
                  ]
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
            "const": "eventBasedTrigger"
          }
        }
      },
      "type": "Accordion",
      "label": "Event-Based Properties",
      "elements": [
        {
          "type": "Select",
          "label": "Event Type",
          "scope": "#/properties/eventType",
          "options": [
            {
              "label": "Form Submission",
              "value": "formSubmission"
            },
            {
              "label": "Record Change",
              "value": "recordChange"
            },
            {
              "label": "API Call",
              "value": "apiCall"
            },
            {
              "label": "User Action",
              "value": "userAction"
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
          "label": "Time-based Trigger",
          "value": "timeBasedTrigger",
          "icon": "ClockCountdown"
        },
        {
          "label": "Event-based Trigger",
          "value": "eventBasedTrigger",
          "icon": "CalendarCheck"
        },
        {
          "label": "Conditional Trigger",
          "value": "conditionalTrigger",
          "icon": "ListChecks"
        },
        {
          "label": "System Trigger",
          "value": "systemTrigger",
          "icon": "Notification"
        }
      ],
      "placeholder": "Select Trigger Type..."
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
    "timeSchedule": {
      "type": "object",
      "properties": {
        "allDay": {
          "type": "boolean"
        },
        "starts": {
          "type": "object",
          "properties": {
            "time": {
              "type": "string"
            },
            "date": {
              "type": "string"
            }
          }
        },
        "ends": {
          "type": "object",
          "properties": {
            "time": {
              "type": "string"
            },
            "date": {
              "type": "string"
            }
          }
        },
        "allDayFrequency": {
          "type": "string",
          "options": [
            {
              "label": "None",
              "value": "none"
            },
            {
              "label": "Daily",
              "value": "daily"
            },
            {
              "label": "Weekly",
              "value": "weekly"
            },
            {
              "label": "Monthly",
              "value": "monthly"
            },
            {
              "label": "Yearly",
              "value": "yearly"
            },
            {
              "label": "Custom...",
              "value": "custom"
            }
          ]
        },
        "frequency": {
          "type": "string",
          "options": [
            {
              "label": "None",
              "value": "none"
            },
            {
              "label": "Hourly",
              "value": "hourly"
            },
            {
              "label": "Daily",
              "value": "daily"
            },
            {
              "label": "Weekly",
              "value": "weekly"
            },
            {
              "label": "Monthly",
              "value": "monthly"
            },
            {
              "label": "Yearly",
              "value": "yearly"
            },
            {
              "type": "separator"
            },
            {
              "label": "Custom...",
              "value": "custom"
            }
          ]
        }
      }
    },
    "retrySettings": {
      "type": "object",
      "properties": {
        "interval": {
          "type": "string",
          "options": [
            {
              "label": "Every 15 min",
              "value": "every15min"
            },
            {
              "label": "Every 20 min",
              "value": "every20min"
            },
            {
              "label": "Every 30 min",
              "value": "every30min"
            }
          ]
        },
        "retries": {
          "type": "string",
          "options": [
            {
              "label": "5",
              "value": "5"
            },
            {
              "label": "10",
              "value": "10"
            },
            {
              "label": "15",
              "value": "15"
            }
          ]
        },
        "timeout": {
          "type": "string",
          "options": [
            {
              "label": "30 min",
              "value": "30Min"
            },
            {
              "label": "60 min",
              "value": "60Min"
            },
            {
              "label": "90 min",
              "value": "90Min"
            }
          ]
        }
      }
    },
    "eventType": {
      "type": "string",
      "options": [
        {
          "label": "Form Submission",
          "value": "formSubmission"
        },
        {
          "label": "Record Change",
          "value": "recordChange"
        },
        {
          "label": "API Call",
          "value": "apiCall"
        },
        {
          "label": "User Action",
          "value": "userAction"
        }
      ],
      "placeholder": "Choose the type of event"
    },
    "condition": {
      "type": "object",
      "properties": {
        "rule": {
          "type": "string",
          "options": [
            {
              "label": "Matches Regex",
              "value": "matchesRegex"
            },
            {
              "label": "Does Not Match Regex",
              "value": "doesNotMatchRegex"
            },
            {
              "label": "Is Equal To",
              "value": "isEqualTo"
            },
            {
              "label": "Is Not Equal To",
              "value": "isNotEqualTo"
            },
            {
              "label": "Is Less Than",
              "value": "isLessThan"
            },
            {
              "label": "Is Less Than or Equal To",
              "value": "isLessThanOrEqualTo"
            },
            {
              "label": "Is Greater Than",
              "value": "isGreaterThan"
            },
            {
              "label": "Is Greater Than or Equal To",
              "value": "isGreaterThanOrEqualTo"
            },
            {
              "label": "Contains",
              "value": "contains"
            },
            {
              "label": "Does Not Contain",
              "value": "doesNotContain"
            },
            {
              "label": "Formula is True",
              "value": "formulaIsTrue"
            },
            {
              "label": "Formula is False",
              "value": "formulaIsFalse"
            }
          ]
        },
        "value": {
          "type": "string"
        }
      }
    },
    "systemValue": {
      "type": "string"
    }
  }
}
```


## קישורים חיצוניים

- [GitHub](https://github.com/synergycodes/workflowbuilder)
- [YouTube](https://www.youtube.com/@workflowbuilder)
- [Discord](https://discord.com/invite/FDMjRuarFb)
- [Contact Us](https://www.workflowbuilder.io/contact)
- [[ללא טקסט/אייקון]](https://github.com/synergycodes/workflowbuilder/blob/main/apps/demo/src/app/data/nodes/trigger/uischema.ts)
- [[ללא טקסט/אייקון]](https://github.com/synergycodes/workflowbuilder/blob/main/apps/demo/src/app/data/nodes/trigger/schema.ts)
