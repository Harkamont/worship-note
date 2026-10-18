"""HOMR's three annotation aliases for OpenCV builds without generated stubs.

Definitions follow OpenCV 4.13.0 modules/python/src2/typing_stubs_generation/
predefined_types.py (Apache-2.0). They do not change any image operation.
"""
from typing import Sequence, Tuple, Union
import cv2
import numpy
MatLike = Union[cv2.Mat, numpy.ndarray]
Rect = Sequence[int]
RotatedRect = Tuple[Sequence[float], Sequence[float], float]
