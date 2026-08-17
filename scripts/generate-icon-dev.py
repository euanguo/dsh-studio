#!/usr/bin/env python3
"""Compatibility wrapper: official + DEV icons share one generator."""

from pathlib import Path
from runpy import run_path

run_path(str(Path(__file__).with_name('generate-icon-assets.py')), run_name='__main__')
