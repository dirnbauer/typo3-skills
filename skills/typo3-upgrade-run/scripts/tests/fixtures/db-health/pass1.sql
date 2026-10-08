# Triggered by Lolli\Dbdoctor\HealthCheck\TtContentPidMissing
DELETE FROM `tt_content` WHERE `uid` = 4711;
DELETE FROM `tt_content` WHERE `uid` = 12;
# Triggered by Lolli\Dbdoctor\HealthCheck\TtContentLocalizedDuplicates
UPDATE `tt_content` SET `deleted` = 1 WHERE `uid` = 90;
# Triggered by Lolli\Dbdoctor\HealthCheck\TcaTablesPidTranslatedPage
UPDATE `tx_news_domain_model_news` SET `pid` = 7 WHERE `uid` = 3;
