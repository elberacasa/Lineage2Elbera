"""Elbera Tools: portable inventory evidence framing and metadata regressions."""
import unittest

import check_inventory_native as target
from build_meta import build_items, item_use_fields, item_action_fields


class InventoryEvidence(unittest.TestCase):
    def test_native_packet_string_has_two_arguments(self):
        self.assertEqual(target.field_argument_index('dSddSd', 2), 3)
        self.assertEqual(target.field_argument_index('dSddSd', 5), 7)
        for index in (-1, 6, True):
            with self.assertRaises(ValueError):
                target.field_argument_index('dSddSd', index)
        with self.assertRaises(ValueError):
            target.field_argument_index('dx', 1)

    def test_function_scope_excludes_neighbor_and_comments(self):
        source = '''function Other() { Wrong(); }
        // function Chosen() { Wrong(); }
        function bool Chosen(int n) { if(n) { Correct(); } return true; }
        function Last() { Wrong(); }'''
        self.assertEqual(target.script_function(source, 'Chosen'),
                         'if(n) { Correct(); } return true;')
        for source in ['function Chosen() {', 'function Other() {}',
                       'function Chosen() {} function Chosen() {}']:
            with self.assertRaises(ValueError):
                target.script_function(source, 'Chosen')

    def test_recipe_is_exact_group_and_subtype_not_name(self):
        tables = {
            'itemname.json': [{'id': 11, 'name': 'Recipe-shaped weapon', 'popup': 812},
                              {'id': 12, 'name': 'Ordinary object', 'popup': 831},
                              {'id': 13, 'name': 'Recipe-shaped miscellaneous', 'popup': 0}],
            'weapongrp.json': [{'object_id': 11, 'etcitem_type': 5}],
            'armorgrp.json': [],
            'etcitemgrp.json': [{'object_id': 12, 'etcitem_type': 5},
                                {'object_id': 13, 'etcitem_type': 4}],
        }
        result = build_items(tables)
        self.assertIs(result['11']['isRecipe'], False)
        self.assertIs(result['12']['isRecipe'], True)
        self.assertEqual(result['12']['popMsgNum'], 831)  # retain both; UI owns precedence
        self.assertIs(result['13']['isRecipe'], False)
        self.assertEqual(result['13']['popMsgNum'], 0)

    def test_missing_group_and_text_do_not_invent_no_warning(self):
        tables = {
            'itemname.json': [{'id': 21, 'name': 'Name only', 'popup': -1}],
            'weapongrp.json': [{'object_id': 22}], 'armorgrp.json': [],
            'etcitemgrp.json': [{'object_id': 23}],
        }
        result = build_items(tables)
        self.assertIsNone(result['21']['isRecipe'])
        self.assertEqual(result['21']['popMsgNum'], -1)
        self.assertIs(result['22']['isRecipe'], False)
        self.assertIsNone(result['22']['popMsgNum'])
        self.assertIsNone(result['23']['isRecipe'])
        self.assertIsNone(result['23']['popMsgNum'])

    def test_source_integer_domain_is_preserved(self):
        for value in (-0x80000000, -1, 0, 0x7fffffff):
            self.assertEqual(item_use_fields('armor', {}, {'popup': value})['popMsgNum'], value)
        for value in (True, '798', 1.5, 0x80000000, -0x80000001):
            with self.assertRaises(ValueError):
                item_use_fields('etc', {'etcitem_type': 5}, {'popup': value})
        for value in (True, '5', -1, 0x100000000):
            with self.assertRaises(ValueError):
                item_use_fields('etc', {'etcitem_type': value}, {'popup': 0})

    def test_action_inputs_preserve_enum_and_non_boolean_crystallizable(self):
        for value in (0, 1, 2, 3, 4, 0xffffffff):
            result = item_action_fields('etc', {'stackable': value, 'crystallizable': value})
            self.assertEqual(result, {'consumeType': value, 'crystallizable': value})
            self.assertIs(type(result['crystallizable']), int)

    def test_weapon_armor_default_is_native_zero_not_a_template_stackable_guess(self):
        for group in ('weapon', 'armor'):
            self.assertEqual(item_action_fields(group, {'stackable': 3, 'crystallizable': 7}),
                             {'consumeType': 0, 'crystallizable': 7})

    def test_absent_action_inputs_stay_unknown_without_grade_count_or_name_inference(self):
        self.assertEqual(item_action_fields('etc', {'crystal_type': 5, 'count': 500}),
                         {'consumeType': None, 'crystallizable': None})
        self.assertEqual(item_action_fields('weapon', None),
                         {'consumeType': None, 'crystallizable': None})

    def test_action_fields_reject_lossy_or_boolean_inputs(self):
        for field in ('stackable', 'crystallizable'):
            for value in (True, '1', -1, 1.5, 0x100000000):
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    item_action_fields('etc', {field: value})

    def test_item_export_keeps_action_fields_for_real_and_name_only_rows(self):
        result = build_items({'itemname.json': [{'id': 31}, {'id': 32}],
                              'weapongrp.json': [], 'armorgrp.json': [],
                              'etcitemgrp.json': [{'object_id': 31, 'stackable': 3,
                                                   'crystallizable': 0}]})
        self.assertEqual(result['31']['consumeType'], 3)
        self.assertEqual(result['31']['crystallizable'], 0)
        self.assertIsNone(result['32']['consumeType'])
        self.assertIsNone(result['32']['crystallizable'])


if __name__ == '__main__':
    unittest.main()
