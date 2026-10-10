-- ndc_overview: one row per current NDC-11 identifier, flattened into a
-- spreadsheet-style view of the package, its product(s), labeler, ingredients,
-- RxNorm clinical drug, and formulary placement.
CREATE OR REPLACE VIEW ndc_overview AS
WITH ndc AS (
    SELECT ei.id AS identifier_id, ei.entity_id AS package_id,
           ei.value AS ndc11, ei.is_primary,
           seg.labeler_code, seg.product_code, seg.package_code, seg.configuration
    FROM external_identifier ei
    LEFT JOIN ndc_segments seg ON seg.identifier_id = ei.id
    WHERE ei.namespace = 'ndc11'
      AND (ei.valid_to IS NULL OR ei.valid_to > now())
),
-- Products reachable from a package: directly, or through one nested child package.
pkg_product AS (
    SELECT pc.parent_package_id AS package_id, pc.child_product_id AS product_id,
           pc.quantity_mag, pc.quantity_uom
    FROM package_component pc
    WHERE pc.child_product_id IS NOT NULL
      AND (pc.valid_to IS NULL OR pc.valid_to > now())
    UNION
    SELECT outer_pc.parent_package_id, inner_pc.child_product_id,
           outer_pc.quantity_mag * inner_pc.quantity_mag, inner_pc.quantity_uom
    FROM package_component outer_pc
    JOIN package_component inner_pc ON inner_pc.parent_package_id = outer_pc.child_package_id
    WHERE inner_pc.child_product_id IS NOT NULL
      AND (outer_pc.valid_to IS NULL OR outer_pc.valid_to > now())
      AND (inner_pc.valid_to IS NULL OR inner_pc.valid_to > now())
)
SELECT
    n.ndc11,
    COALESCE(n.labeler_code || '-' || n.product_code || '-' || n.package_code,
             substr(n.ndc11, 1, 5) || '-' || substr(n.ndc11, 6, 4) || '-' || substr(n.ndc11, 10, 2)) AS ndc_hyphenated,
    n.configuration                                AS ndc_configuration,
    n.is_primary                                   AS ndc_is_primary,
    e.status                                       AS package_status,
    pkg.description                                AS package_description,
    pkg.container_type,
    pkg.billing_unit,
    pkg.is_unit_of_use,
    lab.name                                       AS labeler_name,
    prod.proprietary_name,
    prod.dose_form,
    prod.is_kit,
    pp.qty                                         AS package_quantity,
    ing.active_ingredients,
    ing.active_moieties,
    ing.strengths,
    ing.inactive_ingredient_count,
    cd.rxcui,
    cd.name                                        AS clinical_drug_name,
    cd.tty                                         AS clinical_drug_tty,
    fi.formulary_items,
    fi.on_formulary,
    ids.other_identifiers,
    n.package_id,
    pp.product_ids,
    n.identifier_id
FROM ndc n
JOIN entity  e   ON e.id = n.package_id
JOIN package pkg ON pkg.id = n.package_id
-- Product(s) in the package; kits may have several.
LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT x.product_id) AS product_ids,
           string_agg(DISTINCT trim_scale(x.quantity_mag)::text
                              || CASE WHEN x.quantity_uom IN ('1', '{each}') THEN '' ELSE ' ' || x.quantity_uom END, ' + ') AS qty,
           (array_agg(x.product_id ORDER BY x.product_id))[1] AS first_product_id
    FROM pkg_product x WHERE x.package_id = n.package_id
) pp ON true
LEFT JOIN product prod ON prod.id = pp.first_product_id
LEFT JOIN labeler lab  ON lab.id = prod.labeler_id
-- Ingredients across all products in the package.
LEFT JOIN LATERAL (
    SELECT string_agg(DISTINCT i.name, ' / ') FILTER (WHERE pi.is_active)        AS active_ingredients,
           string_agg(DISTINCT m.name, ' / ') FILTER (WHERE pi.is_active)        AS active_moieties,
           string_agg(
               i.name || ' ' || trim_scale(pi.strength_num_mag)::text || ' ' || pi.strength_num_uom
               || CASE WHEN pi.strength_den_mag = 1 AND pi.strength_den_uom IN ('1', '{each}') THEN ''
                       ELSE '/' || CASE WHEN pi.strength_den_mag = 1 THEN '' ELSE trim_scale(pi.strength_den_mag)::text || ' ' END
                            || pi.strength_den_uom END,
               '; ' ORDER BY pi.ordinal) FILTER (WHERE pi.is_active)              AS strengths,
           count(*) FILTER (WHERE NOT pi.is_active)                               AS inactive_ingredient_count
    FROM product_ingredient pi
    JOIN ingredient i      ON i.id = pi.ingredient_id
    LEFT JOIN ingredient m ON m.id = COALESCE(pi.basis_ingredient_id, i.active_moiety_id, i.id)
    WHERE pi.product_id = ANY (pp.product_ids)
      AND (pi.valid_to IS NULL OR pi.valid_to > now())
) ing ON true
-- RxNorm clinical drug (SCD/SBD) linked to the package.
LEFT JOIN LATERAL (
    SELECT c.name, c.tty, rx.value AS rxcui
    FROM entity_relationship er
    JOIN clinical_drug c ON c.id = er.to_entity_id
    LEFT JOIN external_identifier rx
           ON rx.entity_id = c.id AND rx.namespace = 'rxnorm_rxcui'
          AND (rx.valid_to IS NULL OR rx.valid_to > now())
    WHERE er.relationship_type = 'package_clinical_drug'
      AND er.from_entity_id = n.package_id
      AND (er.valid_to IS NULL OR er.valid_to > now())
    ORDER BY er.valid_from DESC
    LIMIT 1
) cd ON true
-- Formulary placement (all scopes), with preference rank.
LEFT JOIN LATERAL (
    SELECT string_agg(f.display_name || ' [' || s.name || ' #' || fip.preference_rank || ']', '; '
                      ORDER BY fip.preference_rank) AS formulary_items,
           count(*) > 0 AS on_formulary
    FROM formulary_item_package fip
    JOIN formulary_item f ON f.id = fip.formulary_item_id
    JOIN scope s ON s.id = f.scope_id
    WHERE fip.package_id = n.package_id
      AND (fip.valid_to IS NULL OR fip.valid_to > now())
) fi ON true
-- Any other identifiers on the package (GTIN, NDC10 variants, etc.).
LEFT JOIN LATERAL (
    SELECT string_agg(o.namespace || ':' || o.value, ', ' ORDER BY o.namespace) AS other_identifiers
    FROM external_identifier o
    WHERE o.entity_id = n.package_id AND o.namespace <> 'ndc11'
      AND (o.valid_to IS NULL OR o.valid_to > now())
) ids ON true;
