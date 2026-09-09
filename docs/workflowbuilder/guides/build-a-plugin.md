> מקור: https://www.workflowbuilder.io/docs/guides/build-a-plugin/
> נשמר: 2026-09-09

# Build a plugin

Guides
>
Build a plugin
Build a plugin

Compose registerComponentDecorator, registerFunctionDecorator, and registerPluginTranslation into a plugin function passed to WorkflowBuilder.Root.

A plugin is a synchronous function that registers component decorators, function decorators, JsonForms extensions, and / or translations by calling the SDK’s register* APIs. <WorkflowBuilder.Root> invokes every plugin in the plugins prop in order, once on first mount, via a lazy useState initializer.

Combined with Custom JsonForms control, the three registration functions below cover most customisation needs.

All three are side-effecting and safe to call more than once — pass a name to deduplicate.

Plugins as initializer callbacks
Section titled “Plugins as initializer callbacks”
type WorkflowBuilderPlugin = () => void;

Most plugins combine multiple registrations. Wrap them in a function and pass via the plugins prop on <WorkflowBuilder.Root>:

const myPlugin: WorkflowBuilderPlugin = () => {
  registerComponentDecorator('OptionalAppBarControls', {
    content: MyButton,
    name: 'my-plugin',
  });
  registerFunctionDecorator('trackFutureChange', {
    place: 'after',
    callback: ({ params }) => auditLog(params),
    name: 'my-plugin',
  });
};


<WorkflowBuilder.Root plugins={[myPlugin]} />;

Plugins can also be called directly — the registries are currently module-global singletons. See Known limitations.

registerComponentDecorator
Section titled “registerComponentDecorator”

Add, wrap, or modify a component mounted in a named slot.

function registerComponentDecorator<P = object>(slotName: string, options: ComponentDecoratorOptions<P>): void;


type ComponentDecoratorOptions<P = object> =
  | {
      place?: 'before' | 'after' | 'wrapper';
      content: React.ElementType;
      modifyProps?: (props: P) => P;
      priority?: number;
      name?: string;
    }
  | {
      modifyProps?: (props: P) => P;
      priority?: number;
      name?: string;
    };
Options
Section titled “Options”
place — where to render relative to the slot’s host:
'before' (default) — render your content before the host.
'after' — render after.
'wrapper' — wrap the host entirely (your content receives the host as children).
content — the React component to render.
modifyProps — function receiving the host’s props, returning modified props.
priority — higher = rendered first. Default 0.
name — unique identifier within the slot; prevents duplicate registration across calls.
Available slots
Section titled “Available slots”
Slot name	Where it renders
OptionalAppBarControls	App bar — control buttons area
OptionalAppBarTools	App bar — toolbar area
OptionalAppChildren	App-level children (portals, providers)
OptionalEdgeProperties	Edge properties panel
OptionalFooterContent	Footer area
OptionalHooks	Invisible provider/hook slot
OptionalNodeContent	Inside nodes (receives nodeId prop)
Example
Section titled “Example”
import { registerComponentDecorator } from '@workflowbuilder/sdk';


import { MyCustomButton } from './my-custom-button';


registerComponentDecorator('OptionalAppBarControls', {
  content: MyCustomButton,
  name: 'MyPlugin',
  priority: 10, // shown before decorators with lower priority
});
Typing modifyProps
Section titled “Typing modifyProps”

Pass the slot’s props type as the type parameter so modifyProps is checked against the actual host’s prop shape. Slots that target a built-in component export a matching *Props type from the SDK barrel — for example, DiagramContainerProps for the 'DiagramContainer' slot, ProjectSelectionProps for 'ProjectSelection', and PropertiesBarProps for 'PropertiesBar'.

import { registerComponentDecorator } from '@workflowbuilder/sdk';
import type { DiagramContainerProps } from '@workflowbuilder/sdk';


import { myEdgeTypes } from './edges';


registerComponentDecorator<DiagramContainerProps>('DiagramContainer', {
  modifyProps: (props) => ({
    ...props,
    edgeTypes: { ...props.edgeTypes, ...myEdgeTypes }, // typed against EdgeTypes
  }),
});

For a custom slot you control, type the parameter with your component’s own props instead — registerComponentDecorator<MyButtonProps>('MyCustomSlot', { … }).

registerFunctionDecorator
Section titled “registerFunctionDecorator”

Intercept a decorable function before/after its execution.

function registerFunctionDecorator(functionName: string, options: FunctionDecoratorOptions): void;


type FunctionDecoratorOptions =
  | { place?: 'before'; callback: CallbackBefore; priority?: number; name?: string }
  | { place: 'after'; callback: CallbackAfter; priority?: number; name?: string };


type CallbackBefore = (args: { params: unknown[] }) => void | { replacedParams: unknown[] };
type CallbackAfter = (args: { params: unknown[]; returnValue: unknown }) => void | { replacedReturn: unknown };
Decorable functions
Section titled “Decorable functions”

A non-exhaustive list (grep withOptionalFunctionPlugins in the source for the complete set):

Function name	What it does
getPaletteData	Builds the palette data structure.
getTemplates	Builds the template list.
trackFutureChange	Records an upcoming diagram change.
getControlsDotsItems	Builds the dots-menu items in the app bar.
Return conventions
Section titled “Return conventions”
Before-decorator: return nothing (observe) or { replacedParams: [...] } (substitute arguments).
After-decorator: return nothing (observe) or { replacedReturn: ... } (substitute the result).
Example
Section titled “Example”
import { registerFunctionDecorator } from '@workflowbuilder/sdk';


// Run code BEFORE a function executes
registerFunctionDecorator('trackFutureChange', {
  place: 'before',
  callback: ({ params }) => {
    console.log('Change incoming:', params);
  },
});


// Run code AFTER and optionally replace the return value
registerFunctionDecorator('trackFutureChange', {
  place: 'after',
  callback: ({ params, returnValue }) => {
    return { replacedReturn: modifiedValue };
  },
});
registerPluginTranslation
Section titled “registerPluginTranslation”

Merge additional i18n resources into the plugins.* namespace.

function registerPluginTranslation(resource: PluginTranslationResource): void;
import { registerPluginTranslation } from '@workflowbuilder/sdk';


registerPluginTranslation({
  en: {
    translation: {
      plugins: {
        myPlugin: {
          label: 'My Plugin',
          description: 'Does something useful',
        },
      },
    },
  },
});

Equivalent to passing translations via <WorkflowBuilder.Root jsonForm={{ translations }} />. Use whichever is more convenient for your plugin’s lifecycle.

Previous
Custom JsonForms control
Next
Use Variable Picker

## בלוקי קוד

```
type WorkflowBuilderPlugin = () => void;
```

```
const myPlugin: WorkflowBuilderPlugin = () => {
  registerComponentDecorator('OptionalAppBarControls', {
    content: MyButton,
    name: 'my-plugin',
  });
  registerFunctionDecorator('trackFutureChange', {
    place: 'after',
    callback: ({ params }) => auditLog(params),
    name: 'my-plugin',
  });
};

<WorkflowBuilder.Root plugins={[myPlugin]} />;
```

```
function registerComponentDecorator<P = object>(slotName: string, options: ComponentDecoratorOptions<P>): void;

type ComponentDecoratorOptions<P = object> =
  | {
      place?: 'before' | 'after' | 'wrapper';
      content: React.ElementType;
      modifyProps?: (props: P) => P;
      priority?: number;
      name?: string;
    }
  | {
      modifyProps?: (props: P) => P;
      priority?: number;
      name?: string;
    };
```

```
import { registerComponentDecorator } from '@workflowbuilder/sdk';

import { MyCustomButton } from './my-custom-button';

registerComponentDecorator('OptionalAppBarControls', {
  content: MyCustomButton,
  name: 'MyPlugin',
  priority: 10, // shown before decorators with lower priority
});
```

```
import { registerComponentDecorator } from '@workflowbuilder/sdk';
import type { DiagramContainerProps } from '@workflowbuilder/sdk';

import { myEdgeTypes } from './edges';

registerComponentDecorator<DiagramContainerProps>('DiagramContainer', {
  modifyProps: (props) => ({
    ...props,
    edgeTypes: { ...props.edgeTypes, ...myEdgeTypes }, // typed against EdgeTypes
  }),
});
```

```
function registerFunctionDecorator(functionName: string, options: FunctionDecoratorOptions): void;

type FunctionDecoratorOptions =
  | { place?: 'before'; callback: CallbackBefore; priority?: number; name?: string }
  | { place: 'after'; callback: CallbackAfter; priority?: number; name?: string };

type CallbackBefore = (args: { params: unknown[] }) => void | { replacedParams: unknown[] };
type CallbackAfter = (args: { params: unknown[]; returnValue: unknown }) => void | { replacedReturn: unknown };
```

```
import { registerFunctionDecorator } from '@workflowbuilder/sdk';

// Run code BEFORE a function executes
registerFunctionDecorator('trackFutureChange', {
  place: 'before',
  callback: ({ params }) => {
    console.log('Change incoming:', params);
  },
});

// Run code AFTER and optionally replace the return value
registerFunctionDecorator('trackFutureChange', {
  place: 'after',
  callback: ({ params, returnValue }) => {
    return { replacedReturn: modifiedValue };
  },
});
```

```
function registerPluginTranslation(resource: PluginTranslationResource): void;
```

```
import { registerPluginTranslation } from '@workflowbuilder/sdk';

registerPluginTranslation({
  en: {
    translation: {
      plugins: {
        myPlugin: {
          label: 'My Plugin',
          description: 'Does something useful',
        },
      },
    },
  },
});
```


## קישורים חיצוניים

- [GitHub](https://github.com/synergycodes/workflowbuilder)
- [YouTube](https://www.youtube.com/@workflowbuilder)
- [Discord](https://discord.com/invite/FDMjRuarFb)
- [Contact Us](https://www.workflowbuilder.io/contact)
