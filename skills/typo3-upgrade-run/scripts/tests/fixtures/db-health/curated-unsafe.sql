# Triggered by Lolli\Dbdoctor\HealthCheck\TtContentPidMissing
DELETE FROM `tt_content` WHERE `uid` = 4711;
DELETE FROM `tt_content` WHERE `pid` = 99;
DROP TABLE `tt_content`;
