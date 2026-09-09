> מקור: https://www.workflowbuilder.io/docs/api/forms/dynamiccondition/
> נשמר: 2026-09-09

# DynamicCondition

**DynamicCondition** = `object`

One row in a dynamic-conditions control — two operands (`x`, `y`), a comparison (ComparisonOperator), and a logical operator that joins this condition with the next (`'AND'` / `'OR'`).

Operand strings can be literal values or `{{path}}` template placeholders that resolve against upstream node outputs.
