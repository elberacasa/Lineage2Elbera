"""Portable admission tests; extraction requires pinned private client inputs."""
import unittest
from native_audio_profile import selected_config, literal_bool


class AudioProfileTests(unittest.TestCase):
    def test_exact_section_selection_never_mixes_other_drivers(self):
        text = '[Other]\nChannels=99\n[Audio]\nChannels=32\n;UseEAX=True\nUseEAX=False\n'
        self.assertEqual(selected_config(text, 'Audio', ['Channels', 'UseEAX']),
                         {'Channels': '32', 'UseEAX': 'False'})

    def test_missing_or_repeated_selected_keys_are_not_guessed(self):
        for text in ('[Audio]\n', '[Other]\nChannels=32', '[Audio]\nChannels=32\nChannels=16',
                     '[Audio]\nChannels=32\n[Audio]\nChannels=16'):
            with self.assertRaises(ValueError):
                selected_config(text, 'Audio', ['Channels'])

    def test_boolean_literals_have_no_truthy_string_fallback(self):
        self.assertTrue(literal_bool('true'))
        self.assertFalse(literal_bool('False'))
        for value in ('', 'yes', '0', 'false ; trailing text'):
            with self.assertRaises(ValueError): literal_bool(value)


if __name__ == '__main__':
    unittest.main()
