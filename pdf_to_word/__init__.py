"""محول ملفات PDF إلى Word مع دعم كامل للغة العربية بجميع الخطوط.

PDF to Word converter with robust Arabic support across all fonts.
"""

from .converter import PdfToWordConverter, ConversionOptions, ConversionResult

__all__ = ["PdfToWordConverter", "ConversionOptions", "ConversionResult"]
__version__ = "1.0.0"
