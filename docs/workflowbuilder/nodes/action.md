> מקור: https://www.workflowbuilder.io/docs/nodes/action/
> נשמר: 2026-09-09

# Action

Built-in Nodes
>
Action
Action

Executes a task such as sending an email, creating a database record, or calling an external service.

The Action node represents a concrete operation your backend executes. It is the most common node type in any workflow - every step that “does something” is modeled as an Action.

When to use
Section titled “When to use”

Use Action nodes wherever your workflow needs to perform work: sending an email to a customer, updating a record in your CRM, calling a third-party API, running a script, or generating a document. Most workflows consist primarily of Trigger nodes, Action nodes, and branching logic between them.

Action nodes are intentionally generic. The Action Type dropdown determines what kind of operation the node represents, and each type reveals its own configuration fields in the properties panel. Your backend interprets the selected type and properties to execute the actual operation.

Action types
Section titled “Action types”

Select the action type from the Action Type dropdown. Each type reveals a different set of configuration fields.

Send Email
Section titled “Send Email”

Sends an email message.

Property	Type	Description
Address	Text	Recipient email address
Copy	Text	CC recipients
Subject	Text	Email subject line
Body	Text	Email body content
Priority	Dropdown	Normal / Low / High
Retries	Number	Number of retry attempts on failure
Retry on Failure	Boolean	Whether to automatically retry on error
Update Record
Section titled “Update Record”

Updates an existing record in a data source.

Property	Type	Description
Data Source	Dropdown	CRM System / Hubspot
Object Type	Dropdown	Order / Lead
Record ID	Text	Identifier of the record to update
Fields to Update	Text	Field mapping expression
Condition for Updates	Text	Condition that must be met before updating
Include Data	Boolean	Whether to include full record data in output
Make API Call
Section titled “Make API Call”

Calls an external HTTP endpoint.

Property	Type	Description
API URL	Text	Endpoint URL
HTTP Method	Dropdown	GET / POST / PUT / DELETE
Headers	Text	Request headers
Body	Text	Request body
Response Format	Dropdown	JSON / XML / Plain Text
Store Response	Dropdown	Variable name to store the response in
Retry on Failure	Boolean	Whether to automatically retry on error
Create Record
Section titled “Create Record”

Creates a new record in a data source.

Property	Type	Description
Data Source	Dropdown	CRM System / Hubspot
Object Type	Dropdown	Order / Lead
Fields to Populate	Text	Field mapping expression
Assign	Dropdown	Team or user to assign the record to
Include Record	Boolean	Whether to include the created record in output
Execute Script
Section titled “Execute Script”

Runs a script in the specified language.

Property	Type	Description
Script Language	Dropdown	JavaScript / Python
Script Editor	Text	The script source code
Script Storing	Text	Variable name to store the script result in
Pass Workflow	Boolean	Whether to pass workflow context to the script
Create New Document
Section titled “Create New Document”

Generates a document from a template.

Property	Type	Description
Template	Dropdown	Invoice Template / Contract Template
Fields to Populate	Text	Data mapping for template variables
Output Format	Dropdown	PDF / DOCX
Save Location	Dropdown	Google Drive / Internal Storage
Send Document	Boolean	Whether to send the document after creation
Shared properties
Section titled “Shared properties”

All action types share the following fields:

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
      "label": "Select Action Type",
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
            "const": "sendEmail"
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
          "type": "Text",
          "scope": "#/properties/sendEmail/properties/subject",
          "label": "Subject",
          "placeholder": "Type your subject here..."
        },
        {
          "type": "TextArea",
          "scope": "#/properties/sendEmail/properties/body",
          "label": "Email Body",
          "placeholder": "Type your message here...",
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
    },
    {
      "rule": {
        "effect": "SHOW",
        "condition": {
          "scope": "#/properties/type",
          "schema": {
            "const": "updateRecord"
          }
        }
      },
      "type": "Accordion",
      "label": "Update Record Settings",
      "elements": [
        {
          "type": "Select",
          "scope": "#/properties/updateRecord/properties/dataSource",
          "label": "Data Source",
          "options": [
            {
              "label": "CRM System",
              "value": "crmSystem"
            },
            {
              "label": "Hubspot",
              "value": "hubspot"
            }
          ]
        },
        {
          "type": "Select",
          "scope": "#/properties/updateRecord/properties/objectType",
          "label": "Object Type",
          "options": [
            {
              "label": "Order",
              "value": "order"
            },
            {
              "label": "Lead",
              "value": "lead"
            }
          ]
        },
        {
          "type": "Text",
          "scope": "#/properties/updateRecord/properties/recordId",
          "label": "Record ID"
        },
        {
          "label": "Fields to Update",
          "type": "TextArea",
          "scope": "#/properties/updateRecord/properties/fieldsToUpdate",
          "placeholder": "Type your fields here",
          "minRows": 5
        },
        {
          "label": "Conditions for Update",
          "type": "TextArea",
          "scope": "#/properties/updateRecord/properties/conditionForUpdates",
          "placeholder": "Type your conditions here",
          "minRows": 5
        },
        {
          "type": "HorizontalLayout",
          "elements": [
            {
              "type": "Label",
              "text": "Include Updated Data in Workflow:"
            },
            {
              "type": "Switch",
              "scope": "#/properties/updateRecord/properties/includeData"
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
            "const": "makeApiCall"
          }
        }
      },
      "type": "Accordion",
      "label": "API Call Settings",
      "elements": [
        {
          "type": "Text",
          "scope": "#/properties/makeAPICall/properties/apiUrl",
          "label": "API Endpoint URL"
        },
        {
          "type": "Select",
          "scope": "#/properties/makeAPICall/properties/httpMethod",
          "label": "HTTP Method",
          "options": [
            {
              "label": "GET",
              "value": "get"
            },
            {
              "label": "POST",
              "value": "post"
            },
            {
              "label": "PUT",
              "value": "put"
            },
            {
              "label": "DELETE",
              "value": "delete"
            }
          ]
        },
        {
          "label": "Headers",
          "type": "TextArea",
          "scope": "#/properties/makeAPICall/properties/headers",
          "placeholder": "Type your headers here",
          "minRows": 5
        },
        {
          "label": "Body/Payload",
          "type": "TextArea",
          "scope": "#/properties/makeAPICall/properties/body",
          "placeholder": "Type your body here",
          "minRows": 5
        },
        {
          "type": "Select",
          "scope": "#/properties/makeAPICall/properties/responseFormat",
          "label": "Expected Response Format",
          "options": [
            {
              "label": "JSON",
              "value": "json"
            },
            {
              "label": "XML",
              "value": "xml"
            },
            {
              "label": "Plain Text",
              "value": "plainText"
            }
          ]
        },
        {
          "type": "Select",
          "scope": "#/properties/makeAPICall/properties/storeResponse",
          "label": "Store Response in Variable",
          "options": [
            {
              "label": "orderUpdateResponse",
              "value": "orderUpdateResponse"
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
              "scope": "#/properties/makeAPICall/properties/retryOnFailure"
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
            "const": "createRecord"
          }
        }
      },
      "type": "Accordion",
      "label": "Record Settings",
      "elements": [
        {
          "type": "Select",
          "scope": "#/properties/createRecord/properties/dataSource",
          "label": "Data Source",
          "options": [
            {
              "label": "CRM System",
              "value": "crmSystem"
            },
            {
              "label": "Hubspot",
              "value": "hubspot"
            }
          ]
        },
        {
          "type": "Select",
          "scope": "#/properties/createRecord/properties/objectType",
          "label": "Object Type",
          "options": [
            {
              "label": "Order",
              "value": "order"
            },
            {
              "label": "Lead",
              "value": "lead"
            }
          ]
        },
        {
          "label": "Fields to Populate",
          "type": "TextArea",
          "scope": "#/properties/createRecord/properties/fieldsToPopulate",
          "placeholder": "Type your fields here",
          "minRows": 5
        },
        {
          "type": "Select",
          "scope": "#/properties/createRecord/properties/assign",
          "label": "Assign to User/Team",
          "options": [
            {
              "label": "Sales Team",
              "value": "salesTeam"
            }
          ]
        },
        {
          "type": "HorizontalLayout",
          "elements": [
            {
              "type": "Label",
              "text": "Include Created Record in Workflow:"
            },
            {
              "type": "Switch",
              "scope": "#/properties/createRecord/properties/includeRecord"
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
            "const": "executeScript"
          }
        }
      },
      "type": "Accordion",
      "label": "Script Settings",
      "elements": [
        {
          "type": "Select",
          "scope": "#/properties/executeScript/properties/scriptLanguage",
          "label": "Script Language",
          "options": [
            {
              "label": "JavaScript",
              "value": "javaScript"
            },
            {
              "label": "Python",
              "value": "python"
            }
          ]
        },
        {
          "label": "Fields to Populate",
          "type": "TextArea",
          "scope": "#/properties/executeScript/properties/scriptEditor",
          "placeholder": "Type your code here",
          "minRows": 5
        },
        {
          "type": "HorizontalLayout",
          "elements": [
            {
              "type": "Label",
              "text": "Pass Workflow Variables to Script:"
            },
            {
              "type": "Switch",
              "scope": "#/properties/executeScript/properties/passWorkflow"
            }
          ]
        },
        {
          "type": "Text",
          "scope": "#/properties/executeScript/properties/scriptStoring",
          "label": "Store ScriptOutput in Variable"
        }
      ]
    },
    {
      "rule": {
        "effect": "SHOW",
        "condition": {
          "scope": "#/properties/type",
          "schema": {
            "const": "createNewDocument"
          }
        }
      },
      "type": "Accordion",
      "label": "Document Settings",
      "elements": [
        {
          "type": "Select",
          "scope": "#/properties/createDocument/properties/template",
          "label": "Template",
          "options": [
            {
              "label": "Invoice Template",
              "value": "invoiceTemplate"
            },
            {
              "label": "Contract Template",
              "value": "contractTemplate"
            }
          ]
        },
        {
          "label": "Fields to Populate",
          "type": "TextArea",
          "scope": "#/properties/createDocument/properties/fieldsToPopulate",
          "placeholder": "Type your fields here",
          "minRows": 5
        },
        {
          "type": "Select",
          "scope": "#/properties/createDocument/properties/outputFormat",
          "label": "Output Format",
          "options": [
            {
              "label": "PDF",
              "value": "pdf"
            },
            {
              "label": "DOCX",
              "value": "docx"
            }
          ]
        },
        {
          "type": "Select",
          "scope": "#/properties/createDocument/properties/saveLocation",
          "label": "Save Location",
          "options": [
            {
              "label": "Google Drive",
              "value": "googleDrive"
            },
            {
              "label": "Internal Storage",
              "value": "internalStorage"
            }
          ]
        },
        {
          "type": "HorizontalLayout",
          "elements": [
            {
              "type": "Label",
              "text": "Send Document viaEmail:"
            },
            {
              "type": "Switch",
              "scope": "#/properties/createDocument/properties/sendDocument"
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
AI Agent node - delegate a step to an AI model or agent
Previous
Trigger
Next
Conditional

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
      "label": "Select Action Type",
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
            "const": "sendEmail"
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
          "type": "Text",
          "scope": "#/properties/sendEmail/properties/subject",
          "label": "Subject",
          "placeholder": "Type your subject here..."
        },
        {
          "type": "TextArea",
          "scope": "#/properties/sendEmail/properties/body",
          "label": "Email Body",
          "placeholder": "Type your message here...",
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
    },
    {
      "rule": {
        "effect": "SHOW",
        "condition": {
          "scope": "#/properties/type",
          "schema": {
            "const": "updateRecord"
          }
        }
      },
      "type": "Accordion",
      "label": "Update Record Settings",
      "elements": [
        {
          "type": "Select",
          "scope": "#/properties/updateRecord/properties/dataSource",
          "label": "Data Source",
          "options": [
            {
              "label": "CRM System",
              "value": "crmSystem"
            },
            {
              "label": "Hubspot",
              "value": "hubspot"
            }
          ]
        },
        {
          "type": "Select",
          "scope": "#/properties/updateRecord/properties/objectType",
          "label": "Object Type",
          "options": [
            {
              "label": "Order",
              "value": "order"
            },
            {
              "label": "Lead",
              "value": "lead"
            }
          ]
        },
        {
          "type": "Text",
          "scope": "#/properties/updateRecord/properties/recordId",
          "label": "Record ID"
        },
        {
          "label": "Fields to Update",
          "type": "TextArea",
          "scope": "#/properties/updateRecord/properties/fieldsToUpdate",
          "placeholder": "Type your fields here",
          "minRows": 5
        },
        {
          "label": "Conditions for Update",
          "type": "TextArea",
          "scope": "#/properties/updateRecord/properties/conditionForUpdates",
          "placeholder": "Type your conditions here",
          "minRows": 5
        },
        {
          "type": "HorizontalLayout",
          "elements": [
            {
              "type": "Label",
              "text": "Include Updated Data in Workflow:"
            },
            {
              "type": "Switch",
              "scope": "#/properties/updateRecord/properties/includeData"
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
            "const": "makeApiCall"
          }
        }
      },
      "type": "Accordion",
      "label": "API Call Settings",
      "elements": [
        {
          "type": "Text",
          "scope": "#/properties/makeAPICall/properties/apiUrl",
          "label": "API Endpoint URL"
        },
        {
          "type": "Select",
          "scope": "#/properties/makeAPICall/properties/httpMethod",
          "label": "HTTP Method",
          "options": [
            {
              "label": "GET",
              "value": "get"
            },
            {
              "label": "POST",
              "value": "post"
            },
            {
              "label": "PUT",
              "value": "put"
            },
            {
              "label": "DELETE",
              "value": "delete"
            }
          ]
        },
        {
          "label": "Headers",
          "type": "TextArea",
          "scope": "#/properties/makeAPICall/properties/headers",
          "placeholder": "Type your headers here",
          "minRows": 5
        },
        {
          "label": "Body/Payload",
          "type": "TextArea",
          "scope": "#/properties/makeAPICall/properties/body",
          "placeholder": "Type your body here",
          "minRows": 5
        },
        {
          "type": "Select",
          "scope": "#/properties/makeAPICall/properties/responseFormat",
          "label": "Expected Response Format",
          "options": [
            {
              "label": "JSON",
              "value": "json"
            },
            {
              "label": "XML",
              "value": "xml"
            },
            {
              "label": "Plain Text",
              "value": "plainText"
            }
          ]
        },
        {
          "type": "Select",
          "scope": "#/properties/makeAPICall/properties/storeResponse",
          "label": "Store Response in Variable",
          "options": [
            {
              "label": "orderUpdateResponse",
              "value": "orderUpdateResponse"
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
              "scope": "#/properties/makeAPICall/properties/retryOnFailure"
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
            "const": "createRecord"
          }
        }
      },
      "type": "Accordion",
      "label": "Record Settings",
      "elements": [
        {
          "type": "Select",
          "scope": "#/properties/createRecord/properties/dataSource",
          "label": "Data Source",
          "options": [
            {
              "label": "CRM System",
              "value": "crmSystem"
            },
            {
              "label": "Hubspot",
              "value": "hubspot"
            }
          ]
        },
        {
          "type": "Select",
          "scope": "#/properties/createRecord/properties/objectType",
          "label": "Object Type",
          "options": [
            {
              "label": "Order",
              "value": "order"
            },
            {
              "label": "Lead",
              "value": "lead"
            }
          ]
        },
        {
          "label": "Fields to Populate",
          "type": "TextArea",
          "scope": "#/properties/createRecord/properties/fieldsToPopulate",
          "placeholder": "Type your fields here",
          "minRows": 5
        },
        {
          "type": "Select",
          "scope": "#/properties/createRecord/properties/assign",
          "label": "Assign to User/Team",
          "options": [
            {
              "label": "Sales Team",
              "value": "salesTeam"
            }
          ]
        },
        {
          "type": "HorizontalLayout",
          "elements": [
            {
              "type": "Label",
              "text": "Include Created Record in Workflow:"
            },
            {
              "type": "Switch",
              "scope": "#/properties/createRecord/properties/includeRecord"
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
            "const": "executeScript"
          }
        }
      },
      "type": "Accordion",
      "label": "Script Settings",
      "elements": [
        {
          "type": "Select",
          "scope": "#/properties/executeScript/properties/scriptLanguage",
          "label": "Script Language",
          "options": [
            {
              "label": "JavaScript",
              "value": "javaScript"
            },
            {
              "label": "Python",
              "value": "python"
            }
          ]
        },
        {
          "label": "Fields to Populate",
          "type": "TextArea",
          "scope": "#/properties/executeScript/properties/scriptEditor",
          "placeholder": "Type your code here",
          "minRows": 5
        },
        {
          "type": "HorizontalLayout",
          "elements": [
            {
              "type": "Label",
              "text": "Pass Workflow Variables to Script:"
            },
            {
              "type": "Switch",
              "scope": "#/properties/executeScript/properties/passWorkflow"
            }
          ]
        },
        {
          "type": "Text",
          "scope": "#/properties/executeScript/properties/scriptStoring",
          "label": "Store ScriptOutput in Variable"
        }
      ]
    },
    {
      "rule": {
        "effect": "SHOW",
        "condition": {
          "scope": "#/properties/type",
          "schema": {
            "const": "createNewDocument"
          }
        }
      },
      "type": "Accordion",
      "label": "Document Settings",
      "elements": [
        {
          "type": "Select",
          "scope": "#/properties/createDocument/properties/template",
          "label": "Template",
          "options": [
            {
              "label": "Invoice Template",
              "value": "invoiceTemplate"
            },
            {
              "label": "Contract Template",
              "value": "contractTemplate"
            }
          ]
        },
        {
          "label": "Fields to Populate",
          "type": "TextArea",
          "scope": "#/properties/createDocument/properties/fieldsToPopulate",
          "placeholder": "Type your fields here",
          "minRows": 5
        },
        {
          "type": "Select",
          "scope": "#/properties/createDocument/properties/outputFormat",
          "label": "Output Format",
          "options": [
            {
              "label": "PDF",
              "value": "pdf"
            },
            {
              "label": "DOCX",
              "value": "docx"
            }
          ]
        },
        {
          "type": "Select",
          "scope": "#/properties/createDocument/properties/saveLocation",
          "label": "Save Location",
          "options": [
            {
              "label": "Google Drive",
              "value": "googleDrive"
            },
            {
              "label": "Internal Storage",
              "value": "internalStorage"
            }
          ]
        },
        {
          "type": "HorizontalLayout",
          "elements": [
            {
              "type": "Label",
              "text": "Send Document viaEmail:"
            },
            {
              "type": "Switch",
              "scope": "#/properties/createDocument/properties/sendDocument"
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
      "options": [
        {
          "label": "Send Email",
          "value": "sendEmail",
          "icon": "EnvelopeSimple"
        },
        {
          "label": "Update Record",
          "value": "updateRecord",
          "icon": "CloudArrowUp"
        },
        {
          "label": "Make API Call",
          "value": "makeApiCall",
          "icon": "WebhooksLogo"
        },
        {
          "label": "Create Record",
          "value": "createRecord",
          "icon": "RowsPlusTop"
        },
        {
          "label": "Execute Script",
          "value": "executeScript",
          "icon": "Code"
        },
        {
          "label": "Create New Document",
          "value": "createNewDocument",
          "icon": "FilePlus"
        }
      ],
      "placeholder": "Select Action Type"
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
    },
    "updateRecord": {
      "type": "object",
      "properties": {
        "dataSource": {
          "type": "string",
          "options": [
            {
              "label": "CRM System",
              "value": "crmSystem"
            },
            {
              "label": "Hubspot",
              "value": "hubspot"
            }
          ]
        },
        "objectType": {
          "type": "string",
          "options": [
            {
              "label": "Order",
              "value": "order"
            },
            {
              "label": "Lead",
              "value": "lead"
            }
          ]
        },
        "recordId": {
          "type": "string"
        },
        "fieldsToUpdate": {
          "type": "string"
        },
        "conditionForUpdates": {
          "type": "string"
        },
        "includeData": {
          "type": "boolean"
        }
      }
    },
    "makeAPICall": {
      "type": "object",
      "properties": {
        "apiUrl": {
          "type": "string"
        },
        "httpMethod": {
          "type": "string",
          "options": [
            {
              "label": "GET",
              "value": "get"
            },
            {
              "label": "POST",
              "value": "post"
            },
            {
              "label": "PUT",
              "value": "put"
            },
            {
              "label": "DELETE",
              "value": "delete"
            }
          ]
        },
        "headers": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "responseFormat": {
          "type": "string",
          "options": [
            {
              "label": "JSON",
              "value": "json"
            },
            {
              "label": "XML",
              "value": "xml"
            },
            {
              "label": "Plain Text",
              "value": "plainText"
            }
          ]
        },
        "storeResponse": {
          "type": "string",
          "options": [
            {
              "label": "orderUpdateResponse",
              "value": "orderUpdateResponse"
            }
          ]
        },
        "retryOnFailure": {
          "type": "boolean"
        }
      }
    },
    "createRecord": {
      "type": "object",
      "properties": {
        "dataSource": {
          "type": "string",
          "options": [
            {
              "label": "CRM System",
              "value": "crmSystem"
            },
            {
              "label": "Hubspot",
              "value": "hubspot"
            }
          ]
        },
        "objectType": {
          "type": "string",
          "options": [
            {
              "label": "Order",
              "value": "order"
            },
            {
              "label": "Lead",
              "value": "lead"
            }
          ]
        },
        "fieldsToPopulate": {
          "type": "string"
        },
        "assign": {
          "type": "string",
          "options": [
            {
              "label": "Sales Team",
              "value": "salesTeam"
            }
          ]
        },
        "includeRecord": {
          "type": "boolean"
        }
      }
    },
    "executeScript": {
      "type": "object",
      "properties": {
        "scriptLanguage": {
          "type": "string",
          "options": [
            {
              "label": "JavaScript",
              "value": "javaScript"
            },
            {
              "label": "Python",
              "value": "python"
            }
          ]
        },
        "scriptEditor": {
          "type": "string"
        },
        "scriptStoring": {
          "type": "string"
        },
        "passWorkflow": {
          "type": "boolean"
        }
      }
    },
    "createDocument": {
      "type": "object",
      "properties": {
        "template": {
          "type": "string",
          "options": [
            {
              "label": "Invoice Template",
              "value": "invoiceTemplate"
            },
            {
              "label": "Contract Template",
              "value": "contractTemplate"
            }
          ]
        },
        "fieldsToPopulate": {
          "type": "string"
        },
        "outputFormat": {
          "type": "string",
          "options": [
            {
              "label": "PDF",
              "value": "pdf"
            },
            {
              "label": "DOCX",
              "value": "docx"
            }
          ]
        },
        "saveLocation": {
          "type": "string",
          "options": [
            {
              "label": "Google Drive",
              "value": "googleDrive"
            },
            {
              "label": "Internal Storage",
              "value": "internalStorage"
            }
          ]
        },
        "sendDocument": {
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
- [[ללא טקסט/אייקון]](https://github.com/synergycodes/workflowbuilder/blob/main/apps/demo/src/app/data/nodes/action/uischema.ts)
- [[ללא טקסט/אייקון]](https://github.com/synergycodes/workflowbuilder/blob/main/apps/demo/src/app/data/nodes/action/schema.ts)
