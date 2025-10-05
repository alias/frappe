// Individual OR group container for DNF logic
frappe.ui.FilterOrGroup = class {
	constructor(opts) {
		$.extend(this, opts);
		this.filters = []; // Filters specific to this group
		this.make();
	}

	make() {
		this.group_container = $(`
			<div class="filter-group-area" style="border: 2px solid #d1d8dd; border-radius: 6px; margin-bottom: 12px; padding: 8px;">
				<div class="filter-group-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
					<button class="btn btn-xs btn-primary add-filter-to-group">
						${__("Add Filter")}
					</button>
					<button class="btn btn-xs btn-danger remove-group" style="margin-left: 8px;">
						${__("Remove Group")}
					</button>
				</div>
				<div class="filters-in-group"></div>
			</div>
		`);

		this.parent_wrapper.find('.filter-groups-container').append(this.group_container);
		this.filters_container = this.group_container.find('.filters-in-group');

		// Set up events
		this.group_container.find('.add-filter-to-group').on('click', () => this.add_filter());
		this.group_container.find('.remove-group').on('click', () => this.remove());

		// Add the first filter
		this.add_filter();
	}

	add_filter(doctype, fieldname, condition, value) {
		let args = {
			parent: this.group_container,
			parent_doctype: this.parent_doctype,
			doctype: doctype || this.parent_doctype,
			_parent_doctype: this._parent_doctype,
			fieldname: fieldname || "name",
			condition: condition,
			value: value,
			index: this.filters.length + 1,
			on_change: () => {
				if (this.on_change) this.on_change();
			},
			filter_items: (dt, fn) => {
				return !this.filter_exists([dt, fn]);
			},
			filter_list: this.filter_list,
		};

		let filter = new frappe.ui.Filter(args);
		filter.filter_edit_area.appendTo(this.filters_container);
		this.filters.push(filter);

		// Override remove to handle cleanup within THIS group only
		const original_remove = filter.remove.bind(filter);
		filter.remove = () => {
			// Remove from THIS group's filters array
			this.filters = this.filters.filter(f => f !== filter);

			// Remove the DOM element
			original_remove();

			// If this was the last filter in the group, remove the group
			if (this.filters.length === 0) {
				this.remove();
			} else if (this.on_change) {
				this.on_change();
			}
		};

		return filter;
	}

	filter_exists(filter_value) {
		return this.filters
			.filter((f) => f.field)
			.some((f) => {
				let f_value = f.get_value();
				if (filter_value.length === 2) {
					return filter_value[0] === f_value[0] && filter_value[1] === f_value[1];
				}
				return frappe.utils.arrays_equal(f_value.slice(0, 4), filter_value.slice(0, 4));
			});
	}

	get_filters() {
		return this.filters
			.filter((f) => f.field)
			.map((f) => f.get_value())
			.filter(value => value && value[2] && (value[3] !== "" && value[3] !== null && value[3] !== undefined));
	}

	remove() {
		// Remove all filters in this group
		this.filters.forEach((f) => {
			try {
				f.filter_edit_area.remove();
				f.field = null;
			} catch (e) {
				// Ignore errors
			}
		});
		this.filters = [];

		// Remove the group container
		this.group_container.remove();

		// Notify parent
		if (this.on_remove) this.on_remove();
	}
};

frappe.ui.FilterGroup = class {
	constructor(opts) {
		$.extend(this, opts);
		this.or_groups = []; // Array to hold OR filter groups for DNF logic
		window.fltr = this;
		if (!this.filter_button) {
			this.wrapper = this.parent;
			this.wrapper.append(this.get_filter_area_template());
			this.set_filter_events();
			// Initialize with one OR group containing one filter
			this.add_or_condition();
		} else {
			this.make_popover();
		}
	}

	make_popover() {
		this.init_filter_popover();
		this.set_clear_all_filters_event();
		this.set_popover_events();
	}

	set_clear_all_filters_event() {
		if (!this.filter_x_button) return;

		this.filter_x_button.on("click", () => {
			if (typeof this.base_list !== "undefined") {
				// It's a list view. Clear all the filters, also the ones in the
				// FilterArea outside this FilterGroup
				this.base_list.filter_area.clear();
			} else {
				// Not a list view, just clear the filters in this FilterGroup
				this.clear_filters();
				// Add a new empty OR group
				this.add_or_condition();
			}
			this.update_filter_button();
		});
	}

	hide_popover() {
		this.filter_button?.popover("hide");
	}

	init_filter_popover() {
		this.filter_button.popover({
			content: this.get_filter_area_template(),
			template: `
				<div class="filter-popover popover">
					<div class="arrow"></div>
					<div class="popover-body popover-content">
					</div>
				</div>
			`,
			html: true,
			trigger: "manual",
			container: "body",
			placement: "bottom",
			offset: "-100px, 0",
		});
	}



	set_popover_events() {
		$(document.body).on("click", (e) => {
			if (this.wrapper && this.wrapper.is(":visible")) {
				const in_datepicker =
					$(e.target).is(".datepicker--cell") ||
					$(e.target).closest(".datepicker--nav-title").length !== 0 ||
					$(e.target).parents(".datepicker--nav-action").length !== 0 ||
					$(e.target).parents(".datepicker").length !== 0 ||
					$(e.target).is(".datepicker--button");

				if (
					$(e.target).parents(".filter-popover").length === 0 &&
					$(e.target).parents(".filter-box").length === 0 &&
					this.filter_button.find($(e.target)).length === 0 &&
					!$(e.target).is(this.filter_button) &&
					!in_datepicker
				) {
					this.wrapper && this.hide_popover();
				}
			}
		});

		this.filter_button.on("click", () => {
			this.filter_button.popover("toggle");
		});

		this.filter_button.on("shown.bs.popover", () => {
			if (!this.wrapper) {
				this.wrapper = $(".filter-popover");
				this.set_filter_events();
				// Initialize with one OR group
				this.add_or_condition();
			}
		});

		this.filter_button.on("hidden.bs.popover", () => {
			this.apply();
		});

		// REDESIGN-TODO: (Temporary) Review and find best solution for this
		frappe.router.on("change", () => {
			if (this.wrapper && this.wrapper.is(":visible")) {
				this.hide_popover();
			}
		});
	}

	apply() {
		this.update_filters();
		this.on_change();
	}

	update_filter_button() {
		// Count total filters across all OR groups
		let total_filters = 0;
		if (this.or_groups) {
			this.or_groups.forEach(group => {
				total_filters += group.filters.length;
			});
		}
		
		const filters_applied = total_filters > 0;
		const button_label = filters_applied
			? __("Filters {0}", [`<span class="filter-label">${total_filters}</span>`])
			: __("Filter");

		this.filter_button
			.toggleClass("btn-default", !filters_applied)
			.toggleClass("btn-primary-light", filters_applied);

		this.filter_button.find(".filter-icon").toggleClass("active", filters_applied);

		this.filter_button.find(".button-label").html(button_label);
		this.filter_button.attr(
			"title",
			`${total_filters} Filter${total_filters > 1 ? "s" : ""} Applied`
		);
	}

	set_filter_events() {
		this.wrapper.find(".add-or-condition").on("click", () => {
			this.add_or_condition();
		});

		this.wrapper.find(".clear-filters").on("click", () => {
			this.clear_filters();
			// After clearing, add a new empty OR group
			this.add_or_condition();
			this.on_change();
			this.hide_popover();
		});

		this.wrapper.find(".apply-filters").on("click", () => this.hide_popover());
	}

	add_filters(filters) {
		// Add filters to the first OR group, or create a new group if none exist
		if (!this.or_groups || this.or_groups.length === 0) {
			this.add_or_condition();
		}
		
		let promises = [];
		for (const filter of filters) {
			const [doctype, fieldname, condition, value] = filter;
			promises.push(() => {
				return Promise.resolve(
					this.or_groups[0].add_filter(doctype, fieldname, condition, value)
				);
			});
		}

		return frappe.run_serially(promises).then(() => this.update_filters());
	}

	get_filter_value(fieldname) {
		// Search for the filter across all OR groups
		if (this.or_groups) {
			for (let group of this.or_groups) {
				let filter_obj = group.filters.find((f) => f.fieldname == fieldname);
				if (filter_obj) {
					return filter_obj.value;
				}
			}
		}
		return undefined;
	}

	filter_exists(filter_value) {
		// filter_value of form: [doctype, fieldname, condition, value]
		// Check in OR groups
		if (this.or_groups) {
			return this.or_groups.some(group => group.filter_exists(filter_value));
		}
		
		return false;
	}

	get_filters() {
		// Return groups of filters (OR between groups, AND within groups)
		if (this.or_groups && this.or_groups.length > 0) {
			let groups = [];
			
			// Get filters from each OR group
			this.or_groups.forEach((or_group) => {
				let group_filters = or_group.get_filters();
				if (group_filters.length > 0) {
					groups.push(group_filters);
				}
			});
			
			// If there's only one group with filters, return flat array for backward compatibility
			if (groups.length === 1) {
				return groups[0];
			}
			
			return groups;
		}
		
		return [];
	}

	update_filters() {
		// OR groups handle their own filter cleanup and auto-remove when empty
		this.update_filter_button();
	}

	clear_filters() {
		// Remove all OR filter groups
		if (this.or_groups) {
			this.or_groups.forEach((group) => {
				try {
					group.remove();
				} catch (e) {
					// Ignore errors
				}
			});
			this.or_groups = [];
		}
		
		// Update once at the end
		this.update_filter_button();
	}

	get_filter(fieldname) {
		// Search for the filter across all OR groups
		if (this.or_groups) {
			for (let group of this.or_groups) {
				let filter = group.filters.find((f) => {
					return f.field && f.field.df.fieldname == fieldname;
				});
				if (filter) return filter;
			}
		}
		return undefined;
	}

	get_filter_area_template() {
		return $(`
			<div class="filter-area">
				<div class="filter-groups-container">
				</div>
				<hr class="divider"></hr>
				<div class="filter-action-buttons mt-2">
					<button class="text-muted add-or-condition btn btn-xs">
						+ ${__("Add OR Condition")}
					</button>
					<div>
						<button class="btn btn-secondary btn-xs clear-filters">
							${__("Clear Filters")}
						</button>
						${
							this.filter_button
								? `<button class="btn btn-primary btn-xs apply-filters">
								${__("Apply Filters")}
							</button>`
								: ""
						}
					</div>
				</div>
			</div>`);
	}

	get_filters_as_object() {
		return this.get_filters().reduce((acc, filter) => {
			return Object.assign(acc, {
				[filter[1]]: [filter[2], filter[3]],
			});
		}, {});
	}

	add_filters_to_filter_group(filters) {
		if (filters && filters.length) {
			// Add filters to the first OR group, or create a new group if none exist
			if (!this.or_groups || this.or_groups.length === 0) {
				this.add_or_condition();
			}
			
			filters.forEach((filter) => {
				this.or_groups[0].add_filter(filter[0], filter[1], filter[2], filter[3]);
			});
		}
	}

	add_or_condition() {
		// Create a new filter group for OR logic
		let or_group = new frappe.ui.FilterOrGroup({
			parent_wrapper: this.wrapper,
			parent_doctype: this.doctype,
			_parent_doctype: this.parent_doctype,
			filter_list: this.base_list || this,
			on_change: () => {
				this.update_filters();
				this.on_change();
			},
			on_remove: () => {
				// Remove from or_groups array
				this.or_groups = this.or_groups.filter(g => g !== or_group);
				this.update_filters();
				this.on_change();
			}
		});

		this.or_groups.push(or_group);
	}

	add(filters, refresh = true) {
		if (!filters || (Array.isArray(filters) && filters.length === 0)) return Promise.resolve();

		if (typeof filters[0] === "string") {
			// passed in the format of doctype, field, condition, value
			const filter = Array.from(arguments);
			filters = [filter];
		}

		filters = filters.filter((f) => {
			return !this.exists(f);
		});

		const { non_standard_filters, promise } = this.set_standard_filter(filters);

		return promise
			.then(() => {
				return (
					non_standard_filters.length > 0 &&
					this.filter_list.add_filters(non_standard_filters)
				);
			})
			.then(() => {
				refresh && this.list_view.refresh();
			});
	}
};
