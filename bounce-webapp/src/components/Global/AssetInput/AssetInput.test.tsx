import { useState } from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import AssetInput from "./AssetInput";
import { inputAssets } from "../../../constants/inputAssets";

describe("AssetInput", () => {
  const defaultProps = {
    symbol: inputAssets[0].symbol,
    input: {
      id: "input-id",
      value: "",
      onChange: vi.fn(),
      placeholder: "Enter value",
    },
    maxButton: {
      onClick: vi.fn(),
      disabled: false,
    },
    errorMessage: "",
  };
  it("renders correctly without symbol", () => {
    const props = {
      input: {
        id: "input-id",
        value: "",
        onChange: vi.fn(),
        placeholder: "Size",
      },
      maxButton: {
        onClick: vi.fn(),
        disabled: false,
      },
      errorMessage: "",
    };

    render(<AssetInput {...props} />);
    expect(screen.getByPlaceholderText("Size")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /max/i })).toBeEnabled();
  });

  it("renders correctly with symbol", () => {
    render(<AssetInput {...defaultProps} />);
    expect(screen.getByText(inputAssets[0].symbol)).toBeInTheDocument();
    expect(
      screen.getByAltText(`${inputAssets[0].symbol} Logo`),
    ).toBeInTheDocument();
  });

  it("calls onChange with sanitized value on typing", async () => {
    const user = userEvent.setup();

    const Wrapper = () => {
      const [value, setValue] = useState("");
      return (
        <AssetInput
          symbol={inputAssets[0].symbol}
          input={{
            id: "input-id",
            value: value,
            onChange: setValue,
            placeholder: "Size",
          }}
          maxButton={{
            onClick: vi.fn(),
            disabled: false,
          }}
          errorMessage=""
        />
      );
    };
    render(<Wrapper />);

    const input = screen.getByPlaceholderText("Size") as HTMLInputElement;
    await user.type(input, "0012.3456abc");
    expect(input.value).toBe("12.3456");
  });

  it("updates input value with sanitized value on paste", () => {
    const Wrapper = () => {
      const [value, setValue] = useState("");
      return (
        <AssetInput
          symbol={inputAssets[0].symbol}
          input={{
            id: "input-id",
            value,
            onChange: setValue,
            placeholder: "Size",
          }}
          maxButton={{
            onClick: vi.fn(),
            disabled: false,
          }}
          errorMessage=""
        />
      );
    };

    render(<Wrapper />);

    const input = screen.getByPlaceholderText("Size") as HTMLInputElement;

    fireEvent.paste(input, {
      clipboardData: {
        getData: () => "00.123abc",
      },
    });
    expect(input.value).toBe("0.123");
  });

  it("sanitizes value to correct decimal point", async () => {
    const user = userEvent.setup();

    const Wrapper = () => {
      const [value, setValue] = useState("");
      return (
        <AssetInput
          symbol={inputAssets[0].symbol}
          input={{
            id: "input-id",
            value: value,
            onChange: setValue,
            placeholder: "Size",
          }}
          maxButton={{
            onClick: vi.fn(),
            disabled: false,
          }}
          errorMessage=""
        />
      );
    };

    render(<Wrapper />);

    const input = screen.getByPlaceholderText("Size") as HTMLInputElement;
    await user.type(input, "0.123456789");
    expect(input.value).toBe("0.123456");
  });

  it("calls maxButton onClick when clicked", () => {
    render(<AssetInput {...defaultProps} />);

    const button = screen.getByRole("button", { name: /max/i });
    fireEvent.click(button);

    expect(defaultProps.maxButton.onClick).toHaveBeenCalled();
  });

  it("displays error message when provided", () => {
    render(<AssetInput {...defaultProps} errorMessage="Invalid input" />);

    expect(screen.getByText("Invalid input")).toBeInTheDocument();
  });

  it("disables max button when maxButton.disabled is true", () => {
    render(
      <AssetInput
        {...defaultProps}
        maxButton={{ ...defaultProps.maxButton, disabled: true }}
      />,
    );
    const button = screen.getByRole("button", { name: /max/i });
    expect(button).toBeDisabled();
  });
});
