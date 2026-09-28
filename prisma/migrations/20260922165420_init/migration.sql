CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE measure AS (
  magnitude numeric,
  unit text
);

CREATE TYPE rational_measure AS (
  whole bigint,
  numerator bigint,
  denominator bigint,
  unit text
);

CREATE TYPE measure_range AS (
  lower_bound measure,
  upper_bound measure
);

-- CreateEnum
CREATE TYPE "scope_kind" AS ENUM ('global', 'org', 'site', 'formulary');

-- CreateEnum
CREATE TYPE "entity_type" AS ENUM ('package', 'product', 'clinical_drug', 'ingredient', 'labeler', 'spl', 'formulary_item');

-- CreateEnum
CREATE TYPE "value_type" AS ENUM ('text', 'code', 'number', 'quantity', 'rational', 'boolean', 'date', 'entity_ref', 'json');

-- CreateEnum
CREATE TYPE "resolution_state" AS ENUM ('asserted', 'derived', 'overridden', 'conflicted', 'unknown');

-- CreateEnum
CREATE TYPE "mapping_type" AS ENUM ('exact', 'equivalent', 'broader', 'narrower', 'candidate');

-- CreateEnum
CREATE TYPE "strength_basis" AS ENUM ('as_labeled', 'active_moiety', 'salt');

-- CreateEnum
CREATE TYPE "storage_condition" AS ENUM ('controlled_room', 'refrigerated', 'frozen');

-- CreateEnum
CREATE TYPE "compounding_kind" AS ENUM ('sterile', 'nonsterile');

-- CreateEnum
CREATE TYPE "term_kind" AS ENUM ('ingredient', 'ingredient_class', 'product', 'diluent', 'container_material', 'device_feature', 'vehicle');

-- CreateEnum
CREATE TYPE "rule_context" AS ENUM ('same_container', 'y_site', 'syringe', 'contact', 'vehicle');

-- CreateEnum
CREATE TYPE "rule_effect" AS ENUM ('prohibit', 'require', 'avoid', 'prefer', 'informational');

-- CreateEnum
CREATE TYPE "compat_verdict" AS ENUM ('compatible', 'incompatible', 'conditional', 'variable', 'no_data');

-- CreateEnum
CREATE TYPE "availability_state" AS ENUM ('available', 'constrained', 'allocated', 'shortage', 'unavailable');

-- CreateTable
CREATE TABLE "scope" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "scope_kind" NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,

    CONSTRAINT "scope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "entity_type" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "merged_into" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMPTZ(6),

    CONSTRAINT "entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labeler" (
    "id" UUID NOT NULL,
    "type" "entity_type" NOT NULL DEFAULT 'labeler',
    "name" TEXT NOT NULL,

    CONSTRAINT "labeler_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient" (
    "id" UUID NOT NULL,
    "type" "entity_type" NOT NULL DEFAULT 'ingredient',
    "name" TEXT NOT NULL,
    "active_moiety_id" UUID,

    CONSTRAINT "ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "type" "entity_type" NOT NULL DEFAULT 'product',
    "labeler_id" UUID NOT NULL,
    "proprietary_name" TEXT,
    "dose_form" TEXT,
    "is_kit" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_drug" (
    "id" UUID NOT NULL,
    "type" "entity_type" NOT NULL DEFAULT 'clinical_drug',
    "name" TEXT NOT NULL,
    "tty" TEXT,

    CONSTRAINT "clinical_drug_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package" (
    "id" UUID NOT NULL,
    "type" "entity_type" NOT NULL DEFAULT 'package',
    "description" TEXT,
    "container_type" TEXT,
    "billing_unit" TEXT,
    "is_unit_of_use" BOOLEAN,

    CONSTRAINT "package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulary_item" (
    "id" UUID NOT NULL,
    "type" "entity_type" NOT NULL DEFAULT 'formulary_item',
    "scope_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,

    CONSTRAINT "formulary_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulary_item_package" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "formulary_item_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "preference_rank" INTEGER NOT NULL DEFAULT 1,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "valid_period" tstzrange,

    CONSTRAINT "formulary_item_package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identifier_namespace" (
    "code" TEXT NOT NULL,
    "applies_to" "entity_type"[],
    "is_derived" BOOLEAN NOT NULL DEFAULT false,
    "normalizer" TEXT,

    CONSTRAINT "identifier_namespace_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "external_identifier" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "namespace" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalized_value" TEXT NOT NULL,
    "derived_from_id" UUID,
    "derivation_rule" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "valid_period" tstzrange,
    "source_record_id" UUID,

    CONSTRAINT "external_identifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ndc_segments" (
    "identifier_id" UUID NOT NULL,
    "labeler_code" TEXT NOT NULL,
    "product_code" TEXT NOT NULL,
    "package_code" TEXT NOT NULL,
    "configuration" TEXT NOT NULL,

    CONSTRAINT "ndc_segments_pkey" PRIMARY KEY ("identifier_id")
);

-- CreateTable
CREATE TABLE "ucum_unit" (
    "code" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "to_base" DECIMAL,

    CONSTRAINT "ucum_unit_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ucum_unit_alias" (
    "alias" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "ucum_unit_alias_pkey" PRIMARY KEY ("alias")
);

-- CreateTable
CREATE TABLE "package_component" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "parent_package_id" UUID NOT NULL,
    "child_package_id" UUID,
    "child_product_id" UUID,
    "quantity_mag" DECIMAL NOT NULL,
    "quantity_uom" TEXT NOT NULL,
    "quantity" measure,
    "ordinal" INTEGER NOT NULL DEFAULT 1,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "valid_period" tstzrange,

    CONSTRAINT "package_component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_ingredient" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "basis_ingredient_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "strength_num_mag" DECIMAL NOT NULL,
    "strength_num_uom" TEXT NOT NULL,
    "strength_den_mag" DECIMAL NOT NULL DEFAULT 1,
    "strength_den_uom" TEXT NOT NULL,
    "strength_num" measure,
    "strength_den" measure,
    "strength" measure,
    "basis" "strength_basis" NOT NULL DEFAULT 'as_labeled',
    "ordinal" INTEGER NOT NULL DEFAULT 1,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "valid_period" tstzrange,

    CONSTRAINT "product_ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationship_type" (
    "code" TEXT NOT NULL,
    "from_type" "entity_type" NOT NULL,
    "to_type" "entity_type" NOT NULL,
    "cardinality" TEXT NOT NULL DEFAULT 'many',

    CONSTRAINT "relationship_type_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "entity_relationship" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "relationship_type" TEXT NOT NULL,
    "from_entity_id" UUID NOT NULL,
    "to_entity_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 1,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "valid_period" tstzrange,
    "source_record_id" UUID,

    CONSTRAINT "entity_relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source" (
    "code" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "source_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ingestion_run" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" TEXT NOT NULL,
    "source_release" TEXT,
    "parser_version" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'running',

    CONSTRAINT "ingestion_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_record" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ingestion_run_id" UUID NOT NULL,
    "source_native_id" TEXT NOT NULL,
    "source_url" TEXT,
    "observed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "payload_hash" BYTEA NOT NULL,

    CONSTRAINT "source_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_definition" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "major_version" INTEGER NOT NULL DEFAULT 1,
    "applies_to" "entity_type" NOT NULL,
    "value_type" "value_type" NOT NULL,
    "cardinality" TEXT NOT NULL DEFAULT 'one',
    "unit_dimension" TEXT,
    "code_system" TEXT,
    "ref_entity_type" "entity_type",
    "is_groupable" BOOLEAN NOT NULL DEFAULT false,
    "is_filterable" BOOLEAN NOT NULL DEFAULT true,
    "is_sortable" BOOLEAN NOT NULL DEFAULT false,
    "is_derived" BOOLEAN NOT NULL DEFAULT false,
    "review_on_change" TEXT NOT NULL DEFAULT 'none',
    "display_config" JSONB NOT NULL DEFAULT '{}',
    "validation_schema" JSONB,
    "deprecated_at" TIMESTAMPTZ(6),
    "replaced_by" UUID,

    CONSTRAINT "property_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_assertion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_record_id" UUID,
    "source" TEXT NOT NULL,
    "scope_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 1,
    "text_value" TEXT,
    "code_value" TEXT,
    "number_value" DECIMAL,
    "unit_code" TEXT,
    "rat_whole" BIGINT,
    "rat_num" BIGINT,
    "rat_den" BIGINT,
    "boolean_value" BOOLEAN,
    "date_value" DATE,
    "ref_entity_id" UUID,
    "json_value" JSONB,
    "measure_value" measure,
    "rational_value" rational_measure,
    "is_null_assertion" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DECIMAL,
    "valid_from" TIMESTAMPTZ(6),
    "valid_to" TIMESTAMPTZ(6),
    "valid_period" tstzrange,
    "asserted_by" UUID,
    "justification" TEXT,
    "parser_version" TEXT,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retracted_at" TIMESTAMPTZ(6),

    CONSTRAINT "fact_assertion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolution_policy" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "scope_id" UUID NOT NULL,
    "source_rank" TEXT[],
    "tie_break" TEXT NOT NULL DEFAULT 'latest_observed',
    "conflict_action" TEXT NOT NULL DEFAULT 'flag',
    "version" INTEGER NOT NULL DEFAULT 1,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "valid_period" tstzrange,

    CONSTRAINT "resolution_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolution_run" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "triggered_by" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'running',

    CONSTRAINT "resolution_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_value" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 1,
    "text_value" TEXT,
    "code_value" TEXT,
    "number_value" DECIMAL,
    "unit_code" TEXT,
    "rat_whole" BIGINT,
    "rat_num" BIGINT,
    "rat_den" BIGINT,
    "boolean_value" BOOLEAN,
    "date_value" DATE,
    "ref_entity_id" UUID,
    "json_value" JSONB,
    "measure_value" measure,
    "rational_value" rational_measure,
    "resolution_state" "resolution_state" NOT NULL,
    "winning_assertion_id" UUID,
    "policy_id" UUID,
    "resolution_run_id" UUID NOT NULL,
    "valid_from" TIMESTAMPTZ(6),
    "valid_to" TIMESTAMPTZ(6),
    "valid_period" tstzrange,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMPTZ(6),

    CONSTRAINT "property_value_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_mapping" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject_entity_id" UUID NOT NULL,
    "object_entity_id" UUID NOT NULL,
    "mapping_type" "mapping_type" NOT NULL,
    "scope_id" UUID NOT NULL,
    "asserted_by_source" TEXT NOT NULL,
    "first_seen_run_id" UUID,
    "last_seen_run_id" UUID,
    "source_record_id" UUID,
    "confidence" DECIMAL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "valid_period" tstzrange,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMPTZ(6),
    "invalidated_reason" TEXT,

    CONSTRAINT "entity_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "entity_id" UUID,
    "property_id" UUID,
    "mapping_id" UUID,
    "old_value_id" UUID,
    "new_value_id" UUID,
    "resolution_run_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "derivation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "output_property_id" UUID NOT NULL,
    "implementation" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "derivation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "derivation_input" (
    "derivation_id" UUID NOT NULL,
    "input_property_id" UUID NOT NULL,

    CONSTRAINT "derivation_input_pkey" PRIMARY KEY ("derivation_id","input_property_id")
);

-- CreateTable
CREATE TABLE "derivation_dirty" (
    "entity_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "scope_id" UUID NOT NULL,
    "marked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "derivation_dirty_pkey" PRIMARY KEY ("entity_id","property_id","scope_id")
);

-- CreateTable
CREATE TABLE "property_group_index" (
    "scope_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "group_key" TEXT NOT NULL,
    "display_value" TEXT NOT NULL,
    "sort_mag" DECIMAL,
    "sort_uom" TEXT,
    "sort_value" measure,
    "resolution_run_id" UUID NOT NULL,

    CONSTRAINT "property_group_index_pkey" PRIMARY KEY ("scope_id","entity_id","property_id","ordinal")
);

-- CreateTable
CREATE TABLE "package_catalog_projection" (
    "scope_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL,
    "ndc11" TEXT,
    "gtin" TEXT,
    "ingredient_set_precise" TEXT,
    "ingredient_set_moiety" TEXT,
    "route" TEXT,
    "dose_form" TEXT,
    "container_type" TEXT,
    "fill_volume_mag" DECIMAL,
    "fill_volume_uom" TEXT,
    "fill_volume" measure,
    "strength_mag" DECIMAL,
    "strength_uom" TEXT,
    "strength" measure,
    "strength_display" TEXT,
    "labeler_id" UUID,
    "on_formulary" BOOLEAN NOT NULL DEFAULT false,
    "tags" JSONB NOT NULL DEFAULT '{}',
    "resolution_run_id" UUID NOT NULL,
    "refreshed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_catalog_projection_pkey" PRIMARY KEY ("scope_id","package_id")
);

-- CreateTable
CREATE TABLE "catalog_view" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "entity_scope" "entity_type" NOT NULL DEFAULT 'package',
    "filter_expression" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "owner_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'ok',

    CONSTRAINT "catalog_view_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_view_level" (
    "view_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "property_id" UUID NOT NULL,
    "pinned_major_version" INTEGER NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'group',
    "null_behavior" TEXT NOT NULL DEFAULT 'bucket',
    "multi_value_behavior" TEXT NOT NULL DEFAULT 'repeat',
    "sort_strategy" TEXT NOT NULL DEFAULT 'lexical',
    "sort_expression" JSONB,
    "label_template" TEXT,

    CONSTRAINT "catalog_view_level_pkey" PRIMARY KEY ("view_id","position")
);

-- CreateTable
CREATE TABLE "compounding_term" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "term_kind" NOT NULL,
    "ref_entity_id" UUID,
    "code" TEXT,
    "display" TEXT NOT NULL,

    CONSTRAINT "compounding_term_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "term_membership" (
    "member_term_id" UUID NOT NULL,
    "class_term_id" UUID NOT NULL,
    "scope_id" UUID NOT NULL,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "valid_period" tstzrange,

    CONSTRAINT "term_membership_pkey" PRIMARY KEY ("member_term_id","class_term_id","scope_id")
);

-- CreateTable
CREATE TABLE "container_spec" (
    "package_id" UUID NOT NULL,
    "material_term_id" UUID,
    "nominal_volume_mag" DECIMAL,
    "nominal_volume_uom" TEXT DEFAULT 'mL',
    "nominal_volume" measure,
    "labeled_fill_mag" DECIMAL,
    "labeled_fill_uom" TEXT DEFAULT 'mL',
    "labeled_fill" measure,
    "overfill_mag" DECIMAL NOT NULL DEFAULT 0,
    "overfill_uom" TEXT NOT NULL DEFAULT 'mL',
    "overfill" measure,
    "max_fill_mag" DECIMAL,
    "max_fill_uom" TEXT DEFAULT 'mL',
    "max_fill" measure,
    "residual_mag" DECIMAL NOT NULL DEFAULT 0,
    "residual_uom" TEXT NOT NULL DEFAULT 'mL',
    "residual" measure,
    "dose_type" TEXT,
    "is_light_protective" BOOLEAN NOT NULL DEFAULT false,
    "latex_free" BOOLEAN,
    "dehp_free" BOOLEAN,
    "source_record_id" UUID,

    CONSTRAINT "container_spec_pkey" PRIMARY KEY ("package_id")
);

-- CreateTable
CREATE TABLE "compounding_rule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_id" UUID NOT NULL,
    "left_term_id" UUID NOT NULL,
    "right_term_id" UUID NOT NULL,
    "context" "rule_context" NOT NULL,
    "verdict" "compat_verdict" NOT NULL,
    "effect" "rule_effect" NOT NULL,
    "penalty_weight" DECIMAL NOT NULL DEFAULT 0,
    "left_conc_lo_mag" DECIMAL,
    "left_conc_hi_mag" DECIMAL,
    "left_conc_uom" TEXT,
    "left_conc_band" measure_range,
    "right_conc_lo_mag" DECIMAL,
    "right_conc_hi_mag" DECIMAL,
    "right_conc_uom" TEXT,
    "right_conc_band" measure_range,
    "storage" "storage_condition",
    "max_contact_mag" DECIMAL,
    "max_contact_uom" TEXT DEFAULT 'h',
    "max_contact" measure,
    "mechanism" TEXT,
    "rationale" TEXT,
    "evidence_ref" TEXT,
    "source_record_id" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "valid_period" tstzrange,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMPTZ(6),

    CONSTRAINT "compounding_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bud_regulatory_limit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_id" UUID NOT NULL,
    "kind" "compounding_kind" NOT NULL,
    "standard_ref" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "storage" "storage_condition" NOT NULL,
    "max_duration_mag" DECIMAL,
    "max_duration_uom" TEXT DEFAULT 'h',
    "max_duration" measure,
    "requires_sterility_test" BOOLEAN NOT NULL DEFAULT false,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "valid_period" tstzrange,

    CONSTRAINT "bud_regulatory_limit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stability_study" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "citation" TEXT NOT NULL,
    "method" TEXT,
    "acceptance_pct" DECIMAL NOT NULL DEFAULT 90,
    "source_record_id" UUID,
    "quality_grade" TEXT,

    CONSTRAINT "stability_study_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stability_cell" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "study_id" UUID NOT NULL,
    "scope_id" UUID NOT NULL,
    "ingredient_term_id" UUID NOT NULL,
    "diluent_term_id" UUID,
    "container_term_id" UUID,
    "conc_lo_mag" DECIMAL NOT NULL,
    "conc_hi_mag" DECIMAL NOT NULL,
    "conc_uom" TEXT NOT NULL,
    "conc_band" measure_range,
    "storage" "storage_condition" NOT NULL,
    "light_protected" BOOLEAN,
    "supported_mag" DECIMAL NOT NULL,
    "supported_uom" TEXT NOT NULL DEFAULT 'h',
    "supported" measure,
    "followed_by_cell_id" UUID,
    "local_cap_mag" DECIMAL,
    "local_cap_uom" TEXT DEFAULT 'h',
    "local_cap" measure,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMPTZ(6),

    CONSTRAINT "stability_cell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "component_in_use_limit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_id" UUID NOT NULL,
    "dose_type" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "package_id" UUID,
    "max_duration_mag" DECIMAL NOT NULL,
    "max_duration_uom" TEXT NOT NULL DEFAULT 'h',
    "max_duration" measure,
    "basis" TEXT,

    CONSTRAINT "component_in_use_limit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preparation_spec" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_id" UUID NOT NULL,
    "kind" "compounding_kind" NOT NULL,
    "bud_category" TEXT NOT NULL,
    "diluent_term_id" UUID,
    "container_term_id" UUID,
    "final_volume_mag" DECIMAL,
    "final_volume_uom" TEXT DEFAULT 'mL',
    "final_volume" measure,
    "storage" "storage_condition" NOT NULL,
    "light_protected" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "preparation_spec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preparation_ingredient" (
    "preparation_id" UUID NOT NULL,
    "ingredient_term_id" UUID NOT NULL,
    "final_conc_mag" DECIMAL NOT NULL,
    "final_conc_uom" TEXT NOT NULL,
    "final_conc" measure,

    CONSTRAINT "preparation_ingredient_pkey" PRIMARY KEY ("preparation_id","ingredient_term_id")
);

-- CreateTable
CREATE TABLE "compound_formula" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_id" UUID NOT NULL,
    "formulary_item_id" UUID,
    "kind" "compounding_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "bud_category" TEXT NOT NULL,
    "default_storage" "storage_condition" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),

    CONSTRAINT "compound_formula_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formula_slot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "formula_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "ingredient_term_id" UUID,
    "target_amount_whole" BIGINT,
    "target_amount_num" BIGINT DEFAULT 0,
    "target_amount_den" BIGINT DEFAULT 1,
    "target_amount_uom" TEXT,
    "target_amount" rational_measure,
    "target_conc_mag" DECIMAL,
    "target_conc_uom" TEXT,
    "target_conc" measure,
    "tolerance_pct" DECIMAL NOT NULL DEFAULT 0,
    "allow_multi_component" BOOLEAN NOT NULL DEFAULT true,
    "ordinal" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "formula_slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_candidate" (
    "slot_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "preference_rank" INTEGER NOT NULL DEFAULT 1,
    "is_restricted" BOOLEAN NOT NULL DEFAULT false,
    "source_conc_mag" DECIMAL,
    "source_conc_uom" TEXT,
    "source_conc" measure,
    "requires_reconstitution" BOOLEAN NOT NULL DEFAULT false,
    "reconstitution_diluent_term_id" UUID,
    "reconstituted_volume_mag" DECIMAL,
    "reconstituted_volume_uom" TEXT DEFAULT 'mL',
    "reconstituted_volume" measure,
    "note" TEXT,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "valid_period" tstzrange,

    CONSTRAINT "slot_candidate_pkey" PRIMARY KEY ("slot_id","package_id")
);

-- CreateTable
CREATE TABLE "component_cost" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "package_id" UUID NOT NULL,
    "scope_id" UUID NOT NULL,
    "cost_per_unit" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "basis" TEXT,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "valid_period" tstzrange,

    CONSTRAINT "component_cost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "component_availability" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "package_id" UUID NOT NULL,
    "scope_id" UUID NOT NULL,
    "state" "availability_state" NOT NULL,
    "on_hand_units" DECIMAL,
    "allocation_units_per_day" DECIMAL,
    "conserve_weight" DECIMAL NOT NULL DEFAULT 0,
    "source" TEXT,
    "observed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "component_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "optimizer_profile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "w_component_count" DECIMAL NOT NULL DEFAULT 1,
    "w_cost" DECIMAL NOT NULL DEFAULT 1,
    "w_waste_cost" DECIMAL NOT NULL DEFAULT 1,
    "w_waste_volume" DECIMAL NOT NULL DEFAULT 0,
    "w_preference" DECIMAL NOT NULL DEFAULT 1,
    "allow_restricted" BOOLEAN NOT NULL DEFAULT false,
    "allow_vial_sharing" BOOLEAN NOT NULL DEFAULT true,
    "min_bud_mag" DECIMAL,
    "min_bud_uom" TEXT DEFAULT 'h',
    "min_bud" measure,
    "max_components_per_slot" INTEGER NOT NULL DEFAULT 6,

    CONSTRAINT "optimizer_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "build_plan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_id" UUID NOT NULL,
    "formula_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "batch_units" INTEGER NOT NULL DEFAULT 1,
    "preparation_id" UUID,
    "objective_value" DECIMAL,
    "total_cost" DECIMAL,
    "total_waste_mag" DECIMAL,
    "total_waste_uom" TEXT DEFAULT 'mL',
    "total_waste" measure,
    "total_waste_cost" DECIMAL,
    "component_count" INTEGER,
    "bud_mag" DECIMAL,
    "bud_uom" TEXT DEFAULT 'h',
    "bud" measure,
    "bud_limiting_factor" TEXT,
    "rank_among_alternatives" INTEGER,
    "solver_version" TEXT NOT NULL,
    "inputs_snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "build_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "build_plan_line" (
    "plan_id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "units" INTEGER NOT NULL,
    "drawn_mag" DECIMAL,
    "drawn_uom" TEXT DEFAULT 'mL',
    "drawn" measure,
    "residual_mag" DECIMAL,
    "residual_uom" TEXT DEFAULT 'mL',
    "residual" measure,
    "residual_disposition" TEXT,
    "retained_until" TIMESTAMPTZ(6),
    "line_cost" DECIMAL,
    "waste_cost" DECIMAL,

    CONSTRAINT "build_plan_line_pkey" PRIMARY KEY ("plan_id","slot_id","package_id")
);

-- CreateTable
CREATE TABLE "build_plan_finding" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "rule_id" UUID,
    "severity" TEXT NOT NULL,
    "detail" TEXT NOT NULL,

    CONSTRAINT "build_plan_finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "open_component" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "lot" TEXT,
    "expires_lot" DATE,
    "opened_at" TIMESTAMPTZ(6) NOT NULL,
    "in_use_until" TIMESTAMPTZ(6) NOT NULL,
    "remaining_mag" DECIMAL NOT NULL,
    "remaining_uom" TEXT NOT NULL DEFAULT 'mL',
    "remaining" measure,
    "environment" TEXT NOT NULL,
    "opened_by_plan" UUID,
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "open_component_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entity_id_type_key" ON "entity"("id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "labeler_id_type_key" ON "labeler"("id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_id_type_key" ON "ingredient"("id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "product_id_type_key" ON "product"("id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_drug_id_type_key" ON "clinical_drug"("id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "package_id_type_key" ON "package"("id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "formulary_item_id_type_key" ON "formulary_item"("id", "type");

-- CreateIndex
CREATE INDEX "external_identifier_entity_id_idx" ON "external_identifier"("entity_id");

-- CreateIndex
CREATE INDEX "external_identifier_namespace_normalized_value_idx" ON "external_identifier"("namespace", "normalized_value");

-- CreateIndex
CREATE INDEX "external_identifier_normalized_value_idx" ON "external_identifier"("normalized_value");

-- CreateIndex
CREATE INDEX "package_component_parent_package_id_idx" ON "package_component"("parent_package_id");

-- CreateIndex
CREATE INDEX "product_ingredient_product_id_idx" ON "product_ingredient"("product_id");

-- CreateIndex
CREATE INDEX "source_record_source_native_id_observed_at_idx" ON "source_record"("source_native_id", "observed_at" DESC);

-- CreateIndex
CREATE INDEX "source_record_payload_hash_idx" ON "source_record"("payload_hash");

-- CreateIndex
CREATE UNIQUE INDEX "source_record_ingestion_run_id_source_native_id_key" ON "source_record"("ingestion_run_id", "source_native_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_definition_key_major_version_key" ON "property_definition"("key", "major_version");

-- CreateIndex
CREATE INDEX "review_item_scope_id_status_severity_idx" ON "review_item"("scope_id", "status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "derivation_output_property_id_version_key" ON "derivation"("output_property_id", "version");

-- CreateIndex
CREATE INDEX "property_group_index_scope_id_property_id_group_key_idx" ON "property_group_index"("scope_id", "property_id", "group_key");

-- CreateIndex
CREATE INDEX "package_catalog_projection_scope_id_ingredient_set_moiety_r_idx" ON "package_catalog_projection"("scope_id", "ingredient_set_moiety", "route");

-- CreateIndex
CREATE INDEX "package_catalog_projection_ndc11_idx" ON "package_catalog_projection"("ndc11");

-- CreateIndex
CREATE INDEX "package_catalog_projection_gtin_idx" ON "package_catalog_projection"("gtin");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_view_scope_id_name_key" ON "catalog_view"("scope_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "compounding_term_kind_ref_entity_id_key" ON "compounding_term"("kind", "ref_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "compounding_term_kind_code_key" ON "compounding_term"("kind", "code");

-- CreateIndex
CREATE UNIQUE INDEX "compound_formula_scope_id_name_version_key" ON "compound_formula"("scope_id", "name", "version");

-- CreateIndex
CREATE INDEX "component_availability_package_id_scope_id_observed_at_idx" ON "component_availability"("package_id", "scope_id", "observed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "optimizer_profile_scope_id_name_key" ON "optimizer_profile"("scope_id", "name");

-- AddForeignKey
ALTER TABLE "scope" ADD CONSTRAINT "scope_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "scope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity" ADD CONSTRAINT "entity_merged_into_fkey" FOREIGN KEY ("merged_into") REFERENCES "entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labeler" ADD CONSTRAINT "labeler_id_type_fkey" FOREIGN KEY ("id", "type") REFERENCES "entity"("id", "type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient" ADD CONSTRAINT "ingredient_id_type_fkey" FOREIGN KEY ("id", "type") REFERENCES "entity"("id", "type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient" ADD CONSTRAINT "ingredient_active_moiety_id_fkey" FOREIGN KEY ("active_moiety_id") REFERENCES "ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_id_type_fkey" FOREIGN KEY ("id", "type") REFERENCES "entity"("id", "type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_labeler_id_fkey" FOREIGN KEY ("labeler_id") REFERENCES "labeler"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_drug" ADD CONSTRAINT "clinical_drug_id_type_fkey" FOREIGN KEY ("id", "type") REFERENCES "entity"("id", "type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package" ADD CONSTRAINT "package_id_type_fkey" FOREIGN KEY ("id", "type") REFERENCES "entity"("id", "type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulary_item" ADD CONSTRAINT "formulary_item_id_type_fkey" FOREIGN KEY ("id", "type") REFERENCES "entity"("id", "type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulary_item" ADD CONSTRAINT "formulary_item_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulary_item_package" ADD CONSTRAINT "formulary_item_package_formulary_item_id_fkey" FOREIGN KEY ("formulary_item_id") REFERENCES "formulary_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulary_item_package" ADD CONSTRAINT "formulary_item_package_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identifier" ADD CONSTRAINT "external_identifier_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identifier" ADD CONSTRAINT "external_identifier_namespace_fkey" FOREIGN KEY ("namespace") REFERENCES "identifier_namespace"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identifier" ADD CONSTRAINT "external_identifier_derived_from_id_fkey" FOREIGN KEY ("derived_from_id") REFERENCES "external_identifier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identifier" ADD CONSTRAINT "external_identifier_source_record_id_fkey" FOREIGN KEY ("source_record_id") REFERENCES "source_record"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ndc_segments" ADD CONSTRAINT "ndc_segments_identifier_id_fkey" FOREIGN KEY ("identifier_id") REFERENCES "external_identifier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ucum_unit_alias" ADD CONSTRAINT "ucum_unit_alias_code_fkey" FOREIGN KEY ("code") REFERENCES "ucum_unit"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_component" ADD CONSTRAINT "package_component_parent_package_id_fkey" FOREIGN KEY ("parent_package_id") REFERENCES "package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_component" ADD CONSTRAINT "package_component_child_package_id_fkey" FOREIGN KEY ("child_package_id") REFERENCES "package"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_component" ADD CONSTRAINT "package_component_child_product_id_fkey" FOREIGN KEY ("child_product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ingredient" ADD CONSTRAINT "product_ingredient_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ingredient" ADD CONSTRAINT "product_ingredient_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ingredient" ADD CONSTRAINT "product_ingredient_basis_ingredient_id_fkey" FOREIGN KEY ("basis_ingredient_id") REFERENCES "ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_relationship" ADD CONSTRAINT "entity_relationship_relationship_type_fkey" FOREIGN KEY ("relationship_type") REFERENCES "relationship_type"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_relationship" ADD CONSTRAINT "entity_relationship_from_entity_id_fkey" FOREIGN KEY ("from_entity_id") REFERENCES "entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_relationship" ADD CONSTRAINT "entity_relationship_to_entity_id_fkey" FOREIGN KEY ("to_entity_id") REFERENCES "entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_relationship" ADD CONSTRAINT "entity_relationship_source_record_id_fkey" FOREIGN KEY ("source_record_id") REFERENCES "source_record"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_run" ADD CONSTRAINT "ingestion_run_source_fkey" FOREIGN KEY ("source") REFERENCES "source"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_ingestion_run_id_fkey" FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_definition" ADD CONSTRAINT "property_definition_replaced_by_fkey" FOREIGN KEY ("replaced_by") REFERENCES "property_definition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_assertion" ADD CONSTRAINT "fact_assertion_source_record_id_fkey" FOREIGN KEY ("source_record_id") REFERENCES "source_record"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_assertion" ADD CONSTRAINT "fact_assertion_source_fkey" FOREIGN KEY ("source") REFERENCES "source"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_assertion" ADD CONSTRAINT "fact_assertion_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_assertion" ADD CONSTRAINT "fact_assertion_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_assertion" ADD CONSTRAINT "fact_assertion_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_assertion" ADD CONSTRAINT "fact_assertion_ref_entity_id_fkey" FOREIGN KEY ("ref_entity_id") REFERENCES "entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_policy" ADD CONSTRAINT "resolution_policy_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_policy" ADD CONSTRAINT "resolution_policy_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_run" ADD CONSTRAINT "resolution_run_triggered_by_fkey" FOREIGN KEY ("triggered_by") REFERENCES "ingestion_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_value" ADD CONSTRAINT "property_value_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_value" ADD CONSTRAINT "property_value_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_value" ADD CONSTRAINT "property_value_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_value" ADD CONSTRAINT "property_value_ref_entity_id_fkey" FOREIGN KEY ("ref_entity_id") REFERENCES "entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_value" ADD CONSTRAINT "property_value_winning_assertion_id_fkey" FOREIGN KEY ("winning_assertion_id") REFERENCES "fact_assertion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_value" ADD CONSTRAINT "property_value_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "resolution_policy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_value" ADD CONSTRAINT "property_value_resolution_run_id_fkey" FOREIGN KEY ("resolution_run_id") REFERENCES "resolution_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_mapping" ADD CONSTRAINT "entity_mapping_subject_entity_id_fkey" FOREIGN KEY ("subject_entity_id") REFERENCES "entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_mapping" ADD CONSTRAINT "entity_mapping_object_entity_id_fkey" FOREIGN KEY ("object_entity_id") REFERENCES "entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_mapping" ADD CONSTRAINT "entity_mapping_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_mapping" ADD CONSTRAINT "entity_mapping_asserted_by_source_fkey" FOREIGN KEY ("asserted_by_source") REFERENCES "source"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_mapping" ADD CONSTRAINT "entity_mapping_first_seen_run_id_fkey" FOREIGN KEY ("first_seen_run_id") REFERENCES "ingestion_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_mapping" ADD CONSTRAINT "entity_mapping_last_seen_run_id_fkey" FOREIGN KEY ("last_seen_run_id") REFERENCES "ingestion_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_mapping" ADD CONSTRAINT "entity_mapping_source_record_id_fkey" FOREIGN KEY ("source_record_id") REFERENCES "source_record"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_item" ADD CONSTRAINT "review_item_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_item" ADD CONSTRAINT "review_item_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_item" ADD CONSTRAINT "review_item_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property_definition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_item" ADD CONSTRAINT "review_item_mapping_id_fkey" FOREIGN KEY ("mapping_id") REFERENCES "entity_mapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_item" ADD CONSTRAINT "review_item_old_value_id_fkey" FOREIGN KEY ("old_value_id") REFERENCES "property_value"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_item" ADD CONSTRAINT "review_item_new_value_id_fkey" FOREIGN KEY ("new_value_id") REFERENCES "property_value"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_item" ADD CONSTRAINT "review_item_resolution_run_id_fkey" FOREIGN KEY ("resolution_run_id") REFERENCES "resolution_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivation" ADD CONSTRAINT "derivation_output_property_id_fkey" FOREIGN KEY ("output_property_id") REFERENCES "property_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivation_input" ADD CONSTRAINT "derivation_input_derivation_id_fkey" FOREIGN KEY ("derivation_id") REFERENCES "derivation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivation_input" ADD CONSTRAINT "derivation_input_input_property_id_fkey" FOREIGN KEY ("input_property_id") REFERENCES "property_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivation_dirty" ADD CONSTRAINT "derivation_dirty_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivation_dirty" ADD CONSTRAINT "derivation_dirty_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivation_dirty" ADD CONSTRAINT "derivation_dirty_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_group_index" ADD CONSTRAINT "property_group_index_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_group_index" ADD CONSTRAINT "property_group_index_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_group_index" ADD CONSTRAINT "property_group_index_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_group_index" ADD CONSTRAINT "property_group_index_resolution_run_id_fkey" FOREIGN KEY ("resolution_run_id") REFERENCES "resolution_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_catalog_projection" ADD CONSTRAINT "package_catalog_projection_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_catalog_projection" ADD CONSTRAINT "package_catalog_projection_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_catalog_projection" ADD CONSTRAINT "package_catalog_projection_labeler_id_fkey" FOREIGN KEY ("labeler_id") REFERENCES "labeler"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_catalog_projection" ADD CONSTRAINT "package_catalog_projection_resolution_run_id_fkey" FOREIGN KEY ("resolution_run_id") REFERENCES "resolution_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_view" ADD CONSTRAINT "catalog_view_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_view_level" ADD CONSTRAINT "catalog_view_level_view_id_fkey" FOREIGN KEY ("view_id") REFERENCES "catalog_view"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_view_level" ADD CONSTRAINT "catalog_view_level_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compounding_term" ADD CONSTRAINT "compounding_term_ref_entity_id_fkey" FOREIGN KEY ("ref_entity_id") REFERENCES "entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term_membership" ADD CONSTRAINT "term_membership_member_term_id_fkey" FOREIGN KEY ("member_term_id") REFERENCES "compounding_term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term_membership" ADD CONSTRAINT "term_membership_class_term_id_fkey" FOREIGN KEY ("class_term_id") REFERENCES "compounding_term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term_membership" ADD CONSTRAINT "term_membership_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_spec" ADD CONSTRAINT "container_spec_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_spec" ADD CONSTRAINT "container_spec_material_term_id_fkey" FOREIGN KEY ("material_term_id") REFERENCES "compounding_term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_spec" ADD CONSTRAINT "container_spec_source_record_id_fkey" FOREIGN KEY ("source_record_id") REFERENCES "source_record"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compounding_rule" ADD CONSTRAINT "compounding_rule_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compounding_rule" ADD CONSTRAINT "compounding_rule_left_term_id_fkey" FOREIGN KEY ("left_term_id") REFERENCES "compounding_term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compounding_rule" ADD CONSTRAINT "compounding_rule_right_term_id_fkey" FOREIGN KEY ("right_term_id") REFERENCES "compounding_term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compounding_rule" ADD CONSTRAINT "compounding_rule_source_record_id_fkey" FOREIGN KEY ("source_record_id") REFERENCES "source_record"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bud_regulatory_limit" ADD CONSTRAINT "bud_regulatory_limit_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stability_study" ADD CONSTRAINT "stability_study_source_record_id_fkey" FOREIGN KEY ("source_record_id") REFERENCES "source_record"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stability_cell" ADD CONSTRAINT "stability_cell_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "stability_study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stability_cell" ADD CONSTRAINT "stability_cell_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stability_cell" ADD CONSTRAINT "stability_cell_ingredient_term_id_fkey" FOREIGN KEY ("ingredient_term_id") REFERENCES "compounding_term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stability_cell" ADD CONSTRAINT "stability_cell_diluent_term_id_fkey" FOREIGN KEY ("diluent_term_id") REFERENCES "compounding_term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stability_cell" ADD CONSTRAINT "stability_cell_container_term_id_fkey" FOREIGN KEY ("container_term_id") REFERENCES "compounding_term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stability_cell" ADD CONSTRAINT "stability_cell_followed_by_cell_id_fkey" FOREIGN KEY ("followed_by_cell_id") REFERENCES "stability_cell"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "component_in_use_limit" ADD CONSTRAINT "component_in_use_limit_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "component_in_use_limit" ADD CONSTRAINT "component_in_use_limit_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "package"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preparation_spec" ADD CONSTRAINT "preparation_spec_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preparation_spec" ADD CONSTRAINT "preparation_spec_diluent_term_id_fkey" FOREIGN KEY ("diluent_term_id") REFERENCES "compounding_term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preparation_spec" ADD CONSTRAINT "preparation_spec_container_term_id_fkey" FOREIGN KEY ("container_term_id") REFERENCES "compounding_term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preparation_ingredient" ADD CONSTRAINT "preparation_ingredient_preparation_id_fkey" FOREIGN KEY ("preparation_id") REFERENCES "preparation_spec"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preparation_ingredient" ADD CONSTRAINT "preparation_ingredient_ingredient_term_id_fkey" FOREIGN KEY ("ingredient_term_id") REFERENCES "compounding_term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compound_formula" ADD CONSTRAINT "compound_formula_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compound_formula" ADD CONSTRAINT "compound_formula_formulary_item_id_fkey" FOREIGN KEY ("formulary_item_id") REFERENCES "formulary_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formula_slot" ADD CONSTRAINT "formula_slot_formula_id_fkey" FOREIGN KEY ("formula_id") REFERENCES "compound_formula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formula_slot" ADD CONSTRAINT "formula_slot_ingredient_term_id_fkey" FOREIGN KEY ("ingredient_term_id") REFERENCES "compounding_term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_candidate" ADD CONSTRAINT "slot_candidate_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "formula_slot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_candidate" ADD CONSTRAINT "slot_candidate_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_candidate" ADD CONSTRAINT "slot_candidate_reconstitution_diluent_term_id_fkey" FOREIGN KEY ("reconstitution_diluent_term_id") REFERENCES "compounding_term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "component_cost" ADD CONSTRAINT "component_cost_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "component_cost" ADD CONSTRAINT "component_cost_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "component_availability" ADD CONSTRAINT "component_availability_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "component_availability" ADD CONSTRAINT "component_availability_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "optimizer_profile" ADD CONSTRAINT "optimizer_profile_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_plan" ADD CONSTRAINT "build_plan_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_plan" ADD CONSTRAINT "build_plan_formula_id_fkey" FOREIGN KEY ("formula_id") REFERENCES "compound_formula"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_plan" ADD CONSTRAINT "build_plan_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "optimizer_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_plan" ADD CONSTRAINT "build_plan_preparation_id_fkey" FOREIGN KEY ("preparation_id") REFERENCES "preparation_spec"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_plan_line" ADD CONSTRAINT "build_plan_line_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "build_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_plan_line" ADD CONSTRAINT "build_plan_line_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "formula_slot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_plan_line" ADD CONSTRAINT "build_plan_line_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_plan_finding" ADD CONSTRAINT "build_plan_finding_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "build_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_plan_finding" ADD CONSTRAINT "build_plan_finding_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "compounding_rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_component" ADD CONSTRAINT "open_component_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_component" ADD CONSTRAINT "open_component_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_component" ADD CONSTRAINT "open_component_opened_by_plan_fkey" FOREIGN KEY ("opened_by_plan") REFERENCES "build_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
