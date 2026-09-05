# Pattern: Accessible Forms

Patterns for building accessible, usable forms. All examples use Bootstrap 5 classes and TYPO3 Fluid conventions.

## Form Landmarks

Important forms can be promoted to landmarks for screen reader quick-navigation. Search forms **must** use the `search` role:

```html
<!-- Search form as landmark -->
<search>
    <form aria-label="{f:translate(key: 'searchForm', extensionName: 'my_sitepackage')}">
        <label for="search-input" class="visually-hidden">
            <f:translate key="searchLabel" extensionName="my_sitepackage" />
        </label>
        <div class="input-group">
            <input type="search" id="search-input" name="q" class="form-control"
                   placeholder="{f:translate(key: 'searchPlaceholder', extensionName: 'my_sitepackage')}"
                   autocomplete="off" />
            <button type="submit" class="btn btn-primary">
                <f:translate key="searchSubmit" extensionName="my_sitepackage" />
            </button>
        </div>
    </form>
</search>
```

The `<search>` element is supported in all modern browsers (2023+). For legacy browsers, add `role="search"` on the `<form>` as fallback.

## Form Basics

Rules:

1. **Use native form elements** -- `<input>`, `<select>`, `<textarea>`, not `<div>` with ARIA roles
2. **Use the right element** -- radio buttons for single choice, checkboxes for multiple, `<select>` for long lists
3. **Keep forms short** -- only ask for what is strictly needed
4. **Label every field** -- no unlabeled inputs, ever
5. **Use `autocomplete`** -- helps users fill forms faster and enables password managers

### Complete Example Form

```html
<form method="post" novalidate>
    <div class="mb-3">
        <label for="fullName" class="form-label required">Full name</label>
        <input type="text" id="fullName" name="fullName" class="form-control"
               autocomplete="name" required
               aria-required="true" />
    </div>

    <div class="mb-3">
        <label for="email" class="form-label required">Email address</label>
        <input type="email" id="email" name="email" class="form-control"
               autocomplete="email" required
               aria-required="true"
               aria-describedby="email-help" />
        <div id="email-help" class="form-text">We will never share your email.</div>
    </div>

    <div class="mb-3">
        <label for="phone" class="form-label">Phone</label>
        <input type="tel" id="phone" name="phone" class="form-control"
               autocomplete="tel" />
    </div>

    <div class="mb-3">
        <label for="message" class="form-label required">Message</label>
        <textarea id="message" name="message" class="form-control" rows="5"
                  required aria-required="true"></textarea>
    </div>

    <button type="submit" class="btn btn-primary">Send message</button>
</form>
```

### Common `autocomplete` Values

| Value | Field |
|---|---|
| `name` | Full name |
| `given-name` | First name |
| `family-name` | Last name |
| `email` | Email address |
| `tel` | Phone number |
| `street-address` | Street address |
| `postal-code` | Zip / postal code |
| `address-level2` | City |
| `country-name` | Country |
| `organization` | Company name |

## Labeling Form Elements

Five techniques, **ranked by preference**:

### 1. `<label for="id">` -- always the best choice

```html
<label for="username" class="form-label">Username</label>
<input type="text" id="username" class="form-control" />
```

### 2. `aria-labelledby` -- when the label text exists elsewhere

```html
<h2 id="shipping-heading">Shipping address</h2>
<!-- ... -->
<input type="text" class="form-control" aria-labelledby="shipping-heading" />
```

### 3. `aria-label` -- when no visible label exists

```html
<!-- Search field with only a placeholder and button -->
<input type="search" class="form-control" aria-label="Search" placeholder="Search..." />
```

### 4. `title` attribute -- not recommended

Triggers a tooltip on hover, not reliably exposed to all assistive technologies.

### 5. Placeholder as label -- NEVER do this

**Anti-patterns to avoid:**

```html
<!-- BAD: placeholder disappears when user types -->
<input type="text" class="form-control" placeholder="Your name" />

<!-- BAD: label hidden when a visible label would be better -->
<label for="name" class="visually-hidden">Name</label>
<input type="text" id="name" class="form-control" placeholder="Name" />
```

Always prefer a visible `<label>`. Only use `visually-hidden` labels when the design truly cannot accommodate visible text (e.g., a compact search bar).

## Describing Form Fields

Use `aria-describedby` to connect help text to a field. Help text must be **always visible**, not hidden in tooltips:

```html
<div class="mb-3">
    <label for="password" class="form-label required">Password</label>
    <input type="password" id="password" class="form-control"
           autocomplete="new-password" required
           aria-required="true"
           aria-describedby="password-help" />
    <div id="password-help" class="form-text">
        At least 8 characters, one uppercase letter, and one number.
    </div>
</div>
```

Multiple descriptions can be combined:

```html
<input type="text" id="iban" class="form-control"
       aria-describedby="iban-help iban-format" />
<div id="iban-help" class="form-text">Your bank account number.</div>
<div id="iban-format" class="form-text">Format: DE89 3704 0044 0532 0130 00</div>
```

## Error Handling

### Field-Level Errors

```html
<div class="mb-3">
    <label for="email" class="form-label required">Email address</label>
    <input type="email" id="email" class="form-control is-invalid"
           aria-required="true"
           aria-invalid="true"
           aria-describedby="email-error" />
    <div id="email-error" class="invalid-feedback" role="alert">
        Please enter a valid email address.
    </div>
</div>
```

Key rules:

- **`aria-invalid="true"`** on the erroneous field
- **`aria-describedby`** pointing to the error message `id`
- **`role="alert"`** or **`aria-live="assertive"`** for dynamically injected errors
- **Bootstrap:** `.is-invalid` on the input, `.invalid-feedback` for the message

### Error Summary at Top of Form

```html
<div class="alert alert-danger" role="alert" aria-labelledby="error-summary-heading">
    <h2 id="error-summary-heading" class="alert-heading h5">
        2 errors found
    </h2>
    <ul class="mb-0">
        <li><a href="#email">Email address: Please enter a valid email address.</a></li>
        <li><a href="#phone">Phone: Please enter a valid phone number.</a></li>
    </ul>
</div>
```

### Error Count in Page Title

When server-side validation fails, prepend the error count to the page title so screen readers announce it immediately:

```
<title>2 errors - Contact - Site Name</title>
```

### SCSS for Error States

```scss
// Components/_form-errors.scss

.form-control.is-invalid,
.form-select.is-invalid,
.form-check-input.is-invalid {
    border-color: $danger;

    &:focus {
        border-color: $danger;
        box-shadow: 0 0 0 0.2rem rgba($danger, 0.25);
    }
}

.invalid-feedback {
    display: block;
    font-size: 0.875rem;
    color: $danger;
    margin-top: 0.25rem;
}

// Error summary
.alert-danger {
    ul {
        padding-left: 1.25rem;
    }

    a {
        color: $danger;
        font-weight: $font-weight-bold;
    }
}
```

## Grouping Fields

Use `<fieldset>` and `<legend>` for semantically related fields. Screen readers announce the legend before each field in the group.

### Radio Group

```html
<fieldset class="mb-3">
    <legend class="form-label">Preferred contact method</legend>
    <div class="form-check">
        <input type="radio" id="contact-email" name="contact" value="email"
               class="form-check-input" />
        <label for="contact-email" class="form-check-label">Email</label>
    </div>
    <div class="form-check">
        <input type="radio" id="contact-phone" name="contact" value="phone"
               class="form-check-input" />
        <label for="contact-phone" class="form-check-label">Phone</label>
    </div>
</fieldset>
```

### Address Group

```html
<fieldset class="mb-4">
    <legend class="h5">Billing address</legend>
    <div class="mb-3">
        <label for="street" class="form-label">Street</label>
        <input type="text" id="street" class="form-control" autocomplete="street-address" />
    </div>
    <div class="row">
        <div class="col-md-4 mb-3">
            <label for="zip" class="form-label">Zip</label>
            <input type="text" id="zip" class="form-control" autocomplete="postal-code" />
        </div>
        <div class="col-md-8 mb-3">
            <label for="city" class="form-label">City</label>
            <input type="text" id="city" class="form-control" autocomplete="address-level2" />
        </div>
    </div>
</fieldset>
```

## Multi-Step Forms

### Step Indicator (Fluid Partial)

```html
<!-- PageView/Partials/Form/StepIndicator.html -->
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-uri-known-prefixed-attribute="true">

<nav aria-label="{f:translate(key: 'formProgress', extensionName: 'my_sitepackage')}">
    <ol class="step-indicator">
        <f:for each="{steps}" as="step" iteration="iter">
            <li class="step-indicator__item{f:if(condition: '{iter.cycle} == {currentStep}', then: ' active')}{f:if(condition: '{iter.cycle} < {currentStep}', then: ' completed')}">
                <span class="step-indicator__number"
                      {f:if(condition: '{iter.cycle} == {currentStep}', then: 'aria-current="step"')}>{iter.cycle}</span>
                <span class="step-indicator__label">{step.label}</span>
            </li>
        </f:for>
    </ol>
</nav>
```

### Step Indicator SCSS

```scss
// Components/_step-indicator.scss

.step-indicator {
    display: flex;
    list-style: none;
    padding: 0;
    margin: 0 0 2rem;

    &__item {
        flex: 1;
        text-align: center;
        position: relative;

        + .step-indicator__item::before {
            content: '';
            position: absolute;
            top: 1rem;
            left: -50%;
            right: 50%;
            height: 0.125rem;
            background-color: $border-color;
        }

        &.completed + .step-indicator__item::before,
        &.completed::before {
            background-color: $success;
        }
    }

    &__number {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: 50%;
        background-color: $gray-300;
        color: $white;
        font-weight: $font-weight-bold;
        font-size: 0.875rem;
        position: relative;
        z-index: 1;
    }

    &__item.active &__number {
        background-color: $primary;
    }

    &__item.completed &__number {
        background-color: $success;
    }

    &__label {
        display: block;
        font-size: 0.75rem;
        margin-top: 0.5rem;
        color: $text-muted;
    }

    &__item.active &__label {
        color: $body-color;
        font-weight: $font-weight-bold;
    }
}
```

Each step should also have a **heading** (e.g., `<h2>Step 2: Shipping address</h2>`) so screen readers understand which section they are in.

## TYPO3 Form Framework Integration

The TYPO3 form framework generates its own HTML structure. To apply these accessibility patterns, **override the Fluid templates** and add ARIA attributes.

Key points:

- Add `aria-required="true"` to required fields in overridden partials
- Add `aria-invalid` and `aria-describedby` for validation error states
- Use `role="alert"` on error message containers
- Add `autocomplete` attributes via YAML form configuration or Fluid overrides

## Labels

```xml
<!-- locallang.xlf (EN) -->
<trans-unit id="searchForm"><source>Search form</source></trans-unit>
<trans-unit id="searchLabel"><source>Search</source></trans-unit>
<trans-unit id="searchPlaceholder"><source>Search...</source></trans-unit>
<trans-unit id="searchSubmit"><source>Search</source></trans-unit>
<trans-unit id="formProgress"><source>Form progress</source></trans-unit>
<trans-unit id="formErrorSummary"><source>Errors found</source></trans-unit>

<!-- de.locallang.xlf (DE) -->
<trans-unit id="searchForm">
    <source>Search form</source>
    <target>Suchformular</target>
</trans-unit>
<trans-unit id="searchLabel">
    <source>Search</source>
    <target>Suche</target>
</trans-unit>
<trans-unit id="searchPlaceholder">
    <source>Search...</source>
    <target>Suchen...</target>
</trans-unit>
<trans-unit id="searchSubmit">
    <source>Search</source>
    <target>Suchen</target>
</trans-unit>
<trans-unit id="formProgress">
    <source>Form progress</source>
    <target>Formularfortschritt</target>
</trans-unit>
<trans-unit id="formErrorSummary">
    <source>Errors found</source>
    <target>Fehler gefunden</target>
</trans-unit>
```

## Checklist

- [ ] Every input has a visible `<label>` with matching `for`/`id`
- [ ] Required fields have `aria-required="true"` and a visual indicator (`*`)
- [ ] `autocomplete` attribute set on common fields (name, email, tel, address)
- [ ] Help text connected via `aria-describedby` and always visible
- [ ] Error messages use `aria-describedby` and `role="alert"`
- [ ] Erroneous fields have `aria-invalid="true"` and `.is-invalid`
- [ ] Error summary at top of form with links to fields
- [ ] Error count in page `<title>` on server-side validation failure
- [ ] Related fields grouped with `<fieldset>` and `<legend>`
- [ ] Radio/checkbox groups wrapped in `<fieldset>` with descriptive `<legend>`
- [ ] Search forms use `role="search"` on the `<form>` element
- [ ] Multi-step forms show progress with `aria-current="step"`
- [ ] Each form step has a heading
- [ ] Native form elements used -- no `<div>` role hacks
- [ ] No placeholder-only labels
- [ ] TYPO3 form framework templates overridden to include ARIA attributes
