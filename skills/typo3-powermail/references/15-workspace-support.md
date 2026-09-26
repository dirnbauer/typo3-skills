# Workspace limits

Inspect `ctrl.versioningWS` on **every** participating table before promising staged publication.
In the reviewed v14 pair, Powermail form/page/field/mail/answer TCA enables versioning, but
powermail_cond container/condition/rule TCA sets **versioningWS = false**.

Do not describe the entire form-plus-conditions graph as workspace-safe. A change to live
condition records is not a draft simply because its form is being previewed in a workspace.
Agree the deployment/publication sequence explicitly and test preview versus live behavior.

Use the backend and `typo3-workspaces`/`typo3-datahandler` for actual versioning operations.
Never synthesize drafts or publication with SQL updates of `t3ver_*`, and never assume stage
IDs or a workspace UID of 1. DataHandler cannot make unsupported tables versionable by itself.

Sources: [Powermail TCA](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Configuration/TCA),
[condition TCA](https://github.com/dirnbauer/powermail_cond/tree/fc5324f9d22ee1bcd3515d3d2ca51793b5545ec1/Configuration/TCA).
