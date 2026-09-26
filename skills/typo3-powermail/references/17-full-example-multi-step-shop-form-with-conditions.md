# Multistep enquiry example

Use the [wizard and condition recipes](../SKILL-EXAMPLES.md#multistep-with-conditional-fields-and-pages).
They replace the old raw-SQL shop seed and fixed legal checklist.

Multistep condition handling exists in both inspected upstream and fork code. Test the actual
wizard, particularly consecutive hidden pages, active-step changes and final submission.
An enquiry form is not an order-processing/payment system, and UI checkboxes do not establish
legal compliance. Define real project business/legal requirements separately.
