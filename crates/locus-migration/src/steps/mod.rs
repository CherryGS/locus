#[path = "000000000001_locus_core_initial_schema.rs"]
mod s001_core;
#[path = "000000000002_locus_file_initial_schema.rs"]
mod s002_file;
#[path = "000000000003_locus_media_initial_schema.rs"]
mod s003_media;
#[path = "000000000004_locus_model_initial_schema.rs"]
mod s004_model;
#[path = "000000000005_locus_twitter_initial_schema.rs"]
mod s005_twitter;
#[path = "000000000006_locus_bilibili_initial_schema.rs"]
mod s006_bilibili;
#[path = "000000000007_locus_civitai_initial_schema.rs"]
mod s007_civitai;
#[path = "000000000008_locus_settings_initial_schema.rs"]
mod s008_settings;
#[path = "000000000009_locus_server_entity_view_preferences.rs"]
mod s009_preferences;
#[path = "000000000010_locus_server_external_access.rs"]
mod s010_access;

pub(crate) use catalog::STEPS;
mod catalog;

#[path = "000000000011_locus_migration_common_query_columns.rs"]
mod s011_common;
#[path = "000000000011_locus_migration_common_query_columns_conversion.rs"]
mod s011_conversion;
#[path = "000000000012_locus_search_invalidation_journal.rs"]
mod s012_search;
#[path = "000000000013_locus_filter_presets.rs"]
mod s013_filter;

#[path = "000000000014_locus_tag_personal_tags.rs"]
mod s014_tag;
#[path = "000000000015_locus_tag_forest.rs"]
mod s015_tag;
