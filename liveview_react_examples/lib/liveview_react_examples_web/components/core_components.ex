defmodule LiveViewReactExamplesWeb.CoreComponents do
  @moduledoc """
  Small UI primitives used by the example application.
  """

  use Phoenix.Component

  alias Phoenix.LiveView.JS

  attr :id, :string, default: nil
  attr :flash, :map, default: %{}
  attr :title, :string, required: true
  attr :kind, :atom, required: true, values: [:info, :error]
  attr :rest, :global

  slot :inner_block

  def flash(assigns) do
    assigns = assign_new(assigns, :id, fn -> "flash-#{assigns.kind}" end)

    ~H"""
    <div
      :if={message = render_slot(@inner_block) || Phoenix.Flash.get(@flash, @kind)}
      id={@id}
      phx-click={JS.push("lv:clear-flash", value: %{key: @kind}) |> hide("##{@id}")}
      role="alert"
      class={[
        "fixed top-2 right-2 z-50 w-80 rounded-lg p-3 ring-1 sm:w-96",
        @kind == :info && "bg-emerald-50 text-emerald-800 ring-emerald-500",
        @kind == :error && "bg-rose-50 text-rose-900 ring-rose-500"
      ]}
      {@rest}
    >
      <p class="flex items-center gap-1.5 text-sm font-semibold leading-6">
        <.icon
          name={
            if @kind == :info,
              do: "hero-information-circle-mini",
              else: "hero-exclamation-circle-mini"
          }
          class="h-4 w-4"
        />
        {@title}
      </p>
      <p class="mt-2 text-sm leading-5">{message}</p>
      <button type="button" class="absolute top-1 right-1 p-2" aria-label="close">
        <.icon name="hero-x-mark-solid" class="h-5 w-5 opacity-50" />
      </button>
    </div>
    """
  end

  attr :flash, :map, required: true
  attr :id, :string, default: "flash-group"

  def flash_group(assigns) do
    ~H"""
    <div id={@id}>
      <.flash kind={:info} title="Success" flash={@flash} />
      <.flash kind={:error} title="Error" flash={@flash} />
      <.flash
        id="client-error"
        kind={:error}
        title="Connection lost"
        phx-disconnected={show(".phx-client-error #client-error")}
        phx-connected={hide("#client-error")}
        hidden
      >
        Attempting to reconnect
      </.flash>
      <.flash
        id="server-error"
        kind={:error}
        title="Server unavailable"
        phx-disconnected={show(".phx-server-error #server-error")}
        phx-connected={hide("#server-error")}
        hidden
      >
        Retrying the connection
      </.flash>
    </div>
    """
  end

  attr :for, :any, required: true
  attr :as, :any, default: nil

  attr :rest, :global,
    include: ~w(autocomplete name rel action enctype method novalidate target multipart)

  slot :inner_block, required: true

  def simple_form(assigns) do
    ~H"""
    <.form :let={form} for={@for} as={@as} {@rest}>
      <div class="mt-10 space-y-8 bg-white">
        {render_slot(@inner_block, form)}
      </div>
    </.form>
    """
  end

  attr :type, :string, default: "button"
  attr :class, :string, default: nil
  attr :rest, :global, include: ~w(disabled form name value)

  slot :inner_block, required: true

  def button(assigns) do
    ~H"""
    <button
      type={@type}
      class={[
        "rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-700",
        "phx-submit-loading:opacity-75",
        @class
      ]}
      {@rest}
    >
      {render_slot(@inner_block)}
    </button>
    """
  end

  attr :id, :string, default: nil
  attr :name, :string, default: nil
  attr :label, :string, default: nil
  attr :value, :any, default: nil
  attr :type, :string, default: "text"
  attr :field, Phoenix.HTML.FormField, default: nil
  attr :errors, :list, default: []

  attr :rest, :global,
    include:
      ~w(accept autocomplete disabled form max maxlength min minlength pattern placeholder readonly required step)

  def input(%{field: %Phoenix.HTML.FormField{} = field} = assigns) do
    errors = if Phoenix.Component.used_input?(field), do: field.errors, else: []

    assigns
    |> assign(field: nil, id: assigns.id || field.id)
    |> assign(:errors, Enum.map(errors, &translate_error/1))
    |> assign(:name, assigns.name || field.name)
    |> assign(:value, if(is_nil(assigns.value), do: field.value, else: assigns.value))
    |> input()
  end

  def input(assigns) do
    ~H"""
    <div>
      <label :if={@label} for={@id} class="block text-sm font-semibold leading-6 text-zinc-800">
        {@label}
      </label>
      <input
        type={@type}
        name={@name}
        id={@id}
        value={Phoenix.HTML.Form.normalize_value(@type, @value)}
        class={[
          "mt-2 block w-full rounded-lg text-zinc-900 focus:ring-0 sm:text-sm",
          @errors == [] && "border-zinc-300 focus:border-zinc-400",
          @errors != [] && "border-rose-400 focus:border-rose-400"
        ]}
        {@rest}
      />
      <p :for={message <- @errors} class="mt-2 text-sm text-rose-600">{message}</p>
    </div>
    """
  end

  attr :class, :string, default: nil
  attr :rest, :global

  slot :inner_block, required: true

  def card(assigns) do
    ~H"""
    <div
      class={["overflow-x-auto rounded-xl border bg-card text-card-foreground shadow-sm", @class]}
      {@rest}
    >
      {render_slot(@inner_block)}
    </div>
    """
  end

  attr :class, :string, default: nil
  attr :rest, :global

  slot :inner_block, required: true

  def card_content(assigns) do
    ~H"""
    <div class={["p-6", @class]} {@rest}>{render_slot(@inner_block)}</div>
    """
  end

  attr :name, :string, required: true
  attr :class, :string, default: nil

  def icon(%{name: "hero-" <> _} = assigns) do
    ~H"""
    <span class={[@name, @class]} />
    """
  end

  attr :class, :string, default: nil
  attr :size, :integer, default: 200
  attr :duration, :integer, default: 15
  attr :anchor, :integer, default: 90
  attr :color_from, :string, default: "#ffaa40"
  attr :color_to, :string, default: "#9c40ff"
  attr :delay, :integer, default: 0

  def border_beam(assigns) do
    style = """
    --size: #{assigns.size};
    --duration: #{assigns.duration};
    --anchor: #{assigns.anchor};
    --border-width: 1;
    --color-from: #{assigns.color_from};
    --color-to: #{assigns.color_to};
    --delay: -#{assigns.delay}s;
    """

    assigns = assign(assigns, style: style)

    ~H"""
    <div
      style={@style}
      class={[
        "pointer-events-none absolute inset-0 rounded-[inherit]",
        "[border:calc(var(--border-width)*1px)_solid_transparent]",
        "![mask-clip:padding-box,border-box] ![mask-composite:intersect]",
        "[mask:linear-gradient(transparent,transparent),linear-gradient(white,white)]",
        "after:absolute after:aspect-square after:w-[calc(var(--size)*1px)]",
        "after:animate-border-beam after:[animation-delay:var(--delay)]",
        "after:[background:linear-gradient(to_left,var(--color-from),var(--color-to),transparent)]",
        "after:[offset-anchor:calc(var(--anchor)*1%)_50%]",
        "after:[offset-path:rect(0_auto_auto_0_round_calc(var(--size)*1px))]",
        @class
      ]}
    />
    """
  end

  def show(js \\ %JS{}, selector), do: JS.show(js, to: selector)
  def hide(js \\ %JS{}, selector), do: JS.hide(js, to: selector)

  defp translate_error({message, options}) do
    Enum.reduce(options, message, fn {key, value}, translated ->
      String.replace(translated, "%{#{key}}", to_string(value))
    end)
  end
end
