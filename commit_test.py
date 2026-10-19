# Sample change for testing automatic commit message generation.


def add_numbers(a: int, b: int) -> int:
    """Return the sum of two integers."""
    return a + b


def multiply_numbers(a: int, b: int) -> int:
    """Return the product of two integers."""
    return a * b


def subtract_numbers(a: int, b: int) -> int:
    """Return the difference between two integers."""
    return a - b


def square_number(number: int) -> int:
    """Return the square of an integer."""
    return number ** 2


def is_even(number: int) -> bool:
    """Return whether an integer is even."""
    return number % 2 == 0


if __name__ == "__main__":
    print(f"2 + 3 = {add_numbers(2, 3)}")
    print(f"2 * 3 = {multiply_numbers(2, 3)}")
    print(f"8 - 3 = {subtract_numbers(8, 3)}")
    print(f"4 ** 2 = {square_number(4)}")
    print(f"Is 4 even? {is_even(4)}")
