# Triggered by Lolli\Dbdoctor\HealthCheck\SysFileReferenceDangling
DELETE FROM `sys_file_reference` WHERE `uid` = 501;
# Triggered by Lolli\Dbdoctor\HealthCheck\TcaTablesTranslatedWithAllowLanguageSynchronization
UPDATE `tt_content` SET `l10n_state` = '{"header":"custom","bodytext":"parent"}' WHERE `uid` = 91;
# Triggered by Lolli\Dbdoctor\HealthCheck\InlineForeignFieldChildrenParentLanguageDifferent
UPDATE `sys_file_reference` SET `deleted` = 1, `t3ver_state` = 0 WHERE `uid` = 502;
