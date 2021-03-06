export default class GridPagination {

	constructor(opts) {
		$.extend(this, opts);
		this.setup_pagination();
	}

	setup_pagination() {
		this.page_length = 200;
		this.page_index = 1;
		this.total_pages = Math.ceil(this.grid.data.length/this.page_length);

		this.render_pagination();
	}

	render_pagination() {
		
		if (this.grid.data.length <= this.page_length) {
			this.wrapper.find('.grid-pagination').html('');
		} else {
			let $pagination_template = this.get_pagination_html();
			this.wrapper.find('.grid-pagination').html($pagination_template);
			this.prev_page_button = this.wrapper.find('.prev-page');
			this.next_page_button = this.wrapper.find('.next-page');
			this.$page_number = this.wrapper.find('.current-page-number');
			this.$total_pages = this.wrapper.find('.total-page-number');
			this.first_page_button = this.wrapper.find('.first-page');
			this.last_page_button = this.wrapper.find('.last-page');

			this.bind_pagination_events();
		}
	}

	bind_pagination_events() {
		this.prev_page_button.on('click', () => {
			this.render_prev_page();
		});

		this.next_page_button.on('click', () => {
			this.render_next_page();
		});

		this.first_page_button.on('click', () => {
			this.go_to_page(1);
		});

		this.last_page_button.on('click', () => {
			this.go_to_page(this.total_pages);
		});
	}


	update_page_numbers() {
		let total_pages = Math.ceil(this.grid.data.length/this.page_length);
		if (this.total_pages !== total_pages) {
			this.total_pages = total_pages;
			this.render_pagination();
		}
	}

	check_page_number() {
		if (this.page_index > this.total_pages && this.page_index > 1) {
			this.go_to_page(this.page_index-1);
		}
	}

	get_pagination_html() {
		let page_text_html = `<div class="page-text">
				<span class="current-page-number page-number">${__(this.page_index)}</span>
				<span>${__('of')}</span>
				<span class="total-page-number page-number"> ${__(this.total_pages)} </span> 
			</div>`;

		return $(`<button class="btn btn-default btn-xs first-page"">
				<span class="first-page-icon">&laquo;</span>
				<span>${__('First')}</span>
			</button>
			<a class="prev-page">&#8249;</a>
			${page_text_html}
			<a class="next-page">&#8250;</a>
			<button class="btn btn-default btn-xs last-page">
				<span>${__('Last')}</span>
				<span class="first-page-icon">&raquo;</span>
			</button>`);
	}

	render_next_page() {
		if (this.page_index*this.page_length < this.grid.data.length) {
			this.page_index++;
			this.go_to_page();
		}
	}

	render_prev_page() {
		if (this.page_index > 1) {
			this.page_index--;
			this.go_to_page();
		}
	}

	go_to_page(index) {
		if (!index) {
			index = this.page_index;
		} else {
			this.page_index = index;
		}
		let $rows = $(this.grid.parent).find(".rows").empty();
		this.grid.render_result_rows($rows, true);
		if (this.$page_number) {
			this.$page_number.text(index);
		}

		this.update_page_numbers();
	}

	go_to_last_page_to_add_row() {
		let total_pages = this.total_pages;
		let page_length = this.page_length;
		if (this.grid.data.length == page_length*total_pages) {
			this.go_to_page(total_pages + 1);
		} else {
			this.go_to_page(total_pages);
		}
		frappe.utils.scroll_to(this.wrapper);
	}

	get_result_length() {
		return this.grid.data.length < this.page_index*this.page_length
			? this.grid.data.length
			: this.page_index*this.page_length;
	}

}