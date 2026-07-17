-- <pre>
local p = {}
local lib       = require('Module:Feature')
local fd    	= require('Module:fd').get
local fdmulti	= require('Module:fd').getmulti
local builder	= require("Module:SimpleHTMLBuilder")
local mw_expr			= mw.ext.ParserFunctions.expr
local gsub,find,sub,len = string.gsub,string.find,string.sub,string.len
local abs,floor,ceil = math.abs,math.floor,math.ceil
local concat = table.concat
local tostring,tonumber,match,pcall = tostring,tonumber,match,pcall

local function expr(val)
	if find(val,"..",1,true) then
		error("not calculable")
	else
		return tonumber(mw_expr(val))
	end
end

local function rounding(val, decimals)
    if decimals == nil or find(val, "[0-9]") == nil or find(val, "<span", 1, true) or find(val, ".", 1, true) == nil then
        return val
    end

    local a, b, c, d = tostring(val):match"([^0-9]*)([0-9]*)%.([0-9]*)(.*)"
    val = tonumber(b .. "." .. c)

	local round = (
		decimals == "abs" and abs(val)
		or decimals == "floor" and floor(val)
		or decimals == "ceil" and ceil(val)
		or decimals == "trunc" and sub(val, 1, (find(val, ".", 1, true) or 0) - 1)
		or floor(val * 10 ^ (decimals) + 0.5) / (10 ^ (decimals))
		)

    val = a .. round .. d

    if tonumber(val) then
    	return tonumber(val)
    end

    return val
end

-- Reminder that this function can and should be improved to be more consistent and work in all cases
local function string_to_formula(args)
    local val = gsub(args," ","")

    while find(val, "to", 1, true) do
        local to       		= sub(val, 1, find(val, "to", 1, true) - 1)
        local para         	= lib.split(to, "(",true)
		local para_len 		= #para
        local j             = para_len
		local total_times   = 0

        while j >= 2 do
            local _, times = gsub(para[j], "%)", "")
            total_times = total_times + times

            if para_len - j >= total_times then
                break
            end

            j = j - 1
        end

        local start = concat(para,"(",j)

        if pcall(expr, start .. "*2") == false then
            return args
        end

        to	       		= sub(val, find(val, "to", 1, true) + 2)
        para			= lib.split(to, ")", true)
		para_len		= #para
		j 				= 1
		total_times		= 0

        while j < para_len do
            local _, times = gsub(para[j], "%(", "")
            total_times = total_times + times

            if j > total_times then
                break
            end

            j = j + 1
        end

        local finish = concat(para,")",1,j)
		local post_finish

		if find(finish,"to",1,true) then
			post_finish = string_to_formula(finish)

			if post_finish == finish then
				return args
			end
		elseif pcall(expr, finish .. "*2") == false then
			return args
		end

        start  = gsub(start, "([%-%+%*%/%^%(%)])", "%%%1")
        finish = gsub(finish, "([%-%+%*%/%^%(%)])", "%%%1")
        val    = gsub(val, start .. "to" .. finish, "(" .. start .. ")" .. "+(" .. "(" .. (post_finish or finish) .. ")" .. "-" .. "(" .. start .. ")" .. ")/(times-1)*(x-1)")
    end

    return val
end

local function gsub_x(val1,val2)
	if val1 == "" and val2 == "" then
		return 1
	end
end

function p.pplevel(frame)
    local args = lib.frameOrParentArguments{frame = frame} or frame
	args["defaultDisplayMaxLevel"]	= "true"
	args["tooltipSize"]				= 41
	return p.pp(args)
end

function p.pp(frame)
    local args = lib.frameOrParentArguments{frame = frame} or frame
	local userError 	= require('Module:User error')
	local debug2

    local count, countstatic        = {41,41}, 41
	local defaultSize               = 18
	args["tooltipSize"] 			= tonumber(args["tooltipSize"])

	do
		--There're multiple user errors throught the function, which are used to hopefully impede users
		--from inserting junk inside the template. Can also be helpful in case the user mistypes and doesn't notice (i.e debug purpose)
		local accepted_args = mw.loadData("Module:Ability_progression/parameters")

	    for i in pairs(args) do
	    	if accepted_args[i] == nil then
	    		return userError("Parameter '" .. i .. "' is not accepted", "LuaError")
	    	end
	    end

	    if args["changedisplay"] and args["changedisplay"] ~= "true" then
	    	return userError("Invalid value for changedisplay. Can only be 'true'", "LuaError")
	    end

		if args["showtype"] and args["showtype"] ~= "false" then
	    	return userError("Invalid value for showtype. Can only be 'false'", "LuaError")
		end

    	if args["defaultDisplayMaxLevel"] and args["defaultDisplayMaxLevel"] ~= "true" then
	    	return userError("Invalid value for defaultDisplayMaxLevel. Can only be 'true'", "LuaError")
	    end

	    if args["tooltipSize"] and args["tooltipSize"] <= defaultSize then
	    	return userError("tooltipSize ("..args["tooltipSize"].. ") cannot be lower or equal than the max default size ("..defaultSize..")")
	    end
	end

	local nowiki		= mw.text.nowiki

    local function gsub_nowiki(val1,val2,val3) --Currently used for "<" and ">" when necessary to not break the tooltip
		if val1 == "" and val3 == "" then
			return nowiki(val2)
		end
	end

    local round                         = {
    	(args["round"] ~= "false" and (args["round"] or 2)) or nil,
    	(args["round1"] ~= "false" and (args["round1"] or 2)) or nil
    }

	local origtable                     = {lib.split(args[1] or "", ";", true), lib.split(args[2] or "", ";", true)}
	--saves values necessary for autogenerating / displaying the formula
    local save_formula_variables        = {{},{}}

    local resulttable                   = {{},{}}

	for orig_index = 1, 2 do
		local orig = origtable[orig_index]
	    local last_value = ""
        local i = 1
        local len_resulttable = 0
        local errorLastValue = false

        while orig[i] and orig[i] ~= "" do
        	orig[i] = gsub(orig[i],"([^%d ]?)([<>])([^%d ]?)",gsub_nowiki)
        	local temp_find_to = find(orig[i], "to", 1, true)
        	local temp_find_x = find(orig[i], "x", 1, true)

            if (temp_find_to or temp_find_x) and find(orig[i], "<", 1, true) == nil then
            	local start, finish, times
				local temp_find_by = find(orig[i], "by", 1, true)
				local temp_find_for = find(orig[i], "for", 1, true)

            	if temp_find_to then
	            	start = sub(orig[i], 1, temp_find_to - 1)

	                if temp_find_by then
	                    finish, times = orig[i]:match"^ *.- *to *(.-) *by *(.-) *$"
	                elseif temp_find_for then
	                    finish, times = orig[i]:match"^ *.- *to *(.-) *for *(.-) *$"
	                else
	                    finish = orig[i]:match"^ *.- *to *(.-) *$"
	                end
	            end

	            start, finish, times = start or "", finish or "", times or ""
                local check_for_valid_input = true

                if temp_find_x == nil and pcall(expr, start .. "*2") and pcall(expr, finish .. "*2") and
                (pcall(expr, times .. "*2") or times == "") then
                    start = expr(start)
                    finish = expr(finish)

                    if times == "" then
                        if save_formula_variables[orig_index].linear_filling or save_formula_variables[orig_index].x_filling then
                        	check_for_valid_input = false
                        else
                        	save_formula_variables[orig_index] = {linear_filling = len_resulttable + 1, start = start, finish = finish, last_value = last_value,
                        		errorLastValue = errorLastValue
                        	}
                            last_value = finish
                            errorLastValue = false
                        end
                    else
                    	if save_formula_variables[orig_index].start == nil then
							save_formula_variables[orig_index] = {start = start, finish = finish}
                    	end

                        times = expr(times)

                        if temp_find_by then
                            times = rounding(abs(finish - start) / times + 1, 0)

                            if last_value == start then
                            	times = times - 1
                            end
                        end

                        count[orig_index] = count[orig_index] - times

                        if count[orig_index] < 0 then
                            return userError("Maximum size exceeded", "LuaError")
                        end

						--x to y for 1, does not actually make any sense, as we can't show both x and y in one cell.
						--so we should error instead
						if times == 1 then
							bucket("debug2").put{msg="Invalid x to y for 1 -> {{pp|"..(args[1] or "").."|"..(args[2] or "").."|"..(args["label1"] or args["type"] or "level").."}}"}
							debug2 = true
						end

						if errorLastValue == start then
                    		bucket("debug2").put{msg="Formula doesn't start immediatelly after last value -> {{pp|"..(args[1] or "").."|"..(args[2] or "").."|"..(args["label1"] or args["type"] or "level").."}}"}
							debug2 = true
						end

						if last_value == start and save_formula_variables[orig_index].linear_filling and save_formula_variables[orig_index].finish == last_value then
							bucket("debug2").put{msg="Cannot rely on last value of linear filling -> {{pp|"..(args[1] or "").."|"..(args[2] or "").."|"..(args["label1"] or args["type"] or "level").."}}"}
							debug2 = true
						end

						if last_value ~= start then
							len_resulttable = len_resulttable + 1
	                        resulttable[orig_index][len_resulttable] = rounding(start, round[orig_index])
	                        times = times - 1
						end

                        for x = 1, times do
                            local result = start + (finish-start) * x / times
                            len_resulttable = len_resulttable + 1
                            resulttable[orig_index][len_resulttable] = rounding(result, round[orig_index])
                        end

                        last_value = finish
                        errorLastValue = false
                    end
                else
                	times = nil
                    local useformula

                    if temp_find_for then
                        useformula, times = orig[i]:match"^ *(.-) *for *(.-) *$"
                    end

                    useformula, times = useformula or orig[i], times or ""

                    if pcall(expr, times .. "*2") then
                    	times = expr(times)
                	elseif times ~= "" then
                		check_for_valid_input = false
                	end

                    if check_for_valid_input and last_value ~= "" then
                        useformula = gsub(useformula, "then", last_value,1)
                    end

                    if check_for_valid_input and temp_find_to then
                        useformula = string_to_formula(useformula)

                        if times ~= "" then
                        	useformula = gsub(useformula, "times", times)
                        end
                    end

                    if check_for_valid_input and pcall(expr, gsub(gsub(useformula, "([%.%d]?)x([%.%d]?)", gsub_x), "times", "2") .. "*2") then
    					if times == "" then
                            if save_formula_variables[orig_index].linear_filling or save_formula_variables[orig_index].x_filling then
	                        	check_for_valid_input = false
	                        else
                        		save_formula_variables[orig_index] = {x_filling = len_resulttable + 1, useformula = useformula, last_value = last_value,
                        			errorLastValue = errorLastValue}
                                last_value = ""
                                errorLastValue = false
                            end
                        else
                            if save_formula_variables[orig_index].useformula == nil then
								save_formula_variables[orig_index].useformula = useformula
	                    	end

                            count[orig_index] = count[orig_index] - times

                            if count[orig_index] < 0 then
                                return userError("Maximum size exceeded", "LuaError")
                            end

		                	if orig[i]:find("then",1,true) and save_formula_variables[orig_index].linear_filling and save_formula_variables[orig_index].finish == last_value then
								bucket("debug2").put{msg="Cannot rely on last value of linear filling -> {{pp|"..(args[1] or "").."|"..(args[2] or "").."|"..(args["label1"] or args["type"] or "level").."}}"}
		                		debug2 = true
		                	end

							if errorLastValue == expr(gsub(useformula, "x", 1)) or last_value == expr(gsub(useformula, "x", 1)) then
                    			bucket("debug2").put{msg="Formula doesn't start immediatelly after last value -> {{pp|"..(args[1] or "").."|"..(args[2] or "").."|"..(args["label1"] or args["type"] or "level").."}}"}
								debug2 = true
							end

                            for x = 1, times do
                                last_value = expr(gsub(useformula, "x", x))
                                len_resulttable = len_resulttable + 1
                                resulttable[orig_index][len_resulttable] = rounding(last_value, round[orig_index])
                            end
                        end
                    else
                        check_for_valid_input = false
                    end
                end

                if check_for_valid_input == false then
                    last_value = ""
                    errorLastValue = false
                    count[orig_index] = count[orig_index] - 1

                    if count[orig_index] < 0 then
                        return userError("Maximum size exceeded", "LuaError")
                    end

					len_resulttable = len_resulttable + 1
                    resulttable[orig_index][len_resulttable] =  orig[i]
                end
            else
                count[orig_index] = count[orig_index] - 1

                if count[orig_index] < 0 then
                    return userError("Maximum size exceeded", "LuaError")
                end

            	if orig[i]:find("then", 1, true) and save_formula_variables[orig_index].linear_filling and save_formula_variables[orig_index].finish == last_value then
					bucket("debug2").put{msg="Cannot rely on last value of linear filling -> {{pp|"..(args[1] or "").."|"..(args[2] or "").."|"..(args["label1"] or args["type"] or "level").."}}"}
            		debug2 = true
            	end

                local value = (last_value == "" and orig[i]) or gsub(orig[i], "then", last_value,1)

                if pcall(expr, value .. "*2") then
                    value = expr(value)

                    if find(orig[i+1] or "", "to",1,true) then
                    	last_value = ""
                    	errorLastValue = value
                    else
                    	last_value = value
                    	errorLastValue = false
                    end

                    value = rounding(value, round[orig_index])
                else
                	errorLastValue = false
                    last_value = ""
                    value = orig[i]
                end

				len_resulttable = len_resulttable + 1
                resulttable[orig_index][len_resulttable] = value
            end

            i = i + 1
        end
    end

    local fill = {defaultSize - #resulttable[1], defaultSize - #resulttable[2], fillingToDefault = false}
    if #resulttable[1] >= #resulttable[2] then
        if save_formula_variables[1].linear_filling == nil and save_formula_variables[1].x_filling == nil then
            fill[2] = #resulttable[1] - #resulttable[2] --fill up to the size of bottom row
        else
        	fill.fillingToDefault = true
        end
    elseif save_formula_variables[2].linear_filling == nil and save_formula_variables[2].x_filling == nil then
        fill[1] = #resulttable[2] - #resulttable[1] --fill up to the size of top row
    else
    	fill.fillingToDefault = true
    end

    if fill[1] < 0 then
        fill[1] = 0
    end

    if fill[2] < 0 then
        fill[2] = 0
    end

	local extendedSize = 0

	if args["tooltipSize"] and fill.fillingToDefault then
		extendedSize = args["tooltipSize"] - defaultSize
	end

	local originalInputSize = #resulttable[1]

    for orig_index = 1, #save_formula_variables do
		local to = save_formula_variables[orig_index]
		local times = fill[orig_index]

    	if to.linear_filling or to.x_filling then
            count[orig_index] = count[orig_index] - times - extendedSize

            if count[orig_index] < 0 then
                return userError("Maximum size exceeded", "LuaError")
            end

            originalInputSize = #resulttable[orig_index] + times

            local len_resulttable = #resulttable[orig_index]
            local spaces_to_move = len_resulttable - (to.linear_filling or to.x_filling) + 1

            for i = 0, spaces_to_move - 1 do
	            --moving the latest values forward to leave space for the filled ones
	        	resulttable[orig_index][len_resulttable+times+extendedSize-i] = resulttable[orig_index][len_resulttable-i]
            end

	        if to.linear_filling then
	            local start, finish, last_value = to.start, to.finish, to.last_value

				local fill_index = to.linear_filling-1
				--x to y for 1, does not actually make any sense, as we can't show both x and y in one cell.
				--so we should error instead
				if times == 1 then
					bucket("debug2").put{msg="Invalid x to y for 1 -> {{pp|"..(args[1] or "").."|"..(args[2] or "").."|"..(args["label1"] or args["type"] or "level").."}}"}
					debug2 = true
				end

				if to.errorLastValue == start then
            		bucket("debug2").put{msg="Formula doesn't start immediatelly after last value -> {{pp|"..(args[1] or "").."|"..(args[2] or "").."|"..(args["label1"] or args["type"] or "level").."}}"}
					debug2 = true
				end

				if last_value ~= start then
					fill_index = fill_index + 1
					resulttable[orig_index][fill_index] = rounding(start, round[orig_index])
                    times = times - 1
                end

	            for x = 1, times+extendedSize do
	                local result = start + (finish-start) * x / times
	                fill_index = fill_index + 1
	                resulttable[orig_index][fill_index] = rounding(result, round[orig_index])
	            end
	        elseif to.x_filling then
				local useformula = gsub(to.useformula, "times", times)
				save_formula_variables[orig_index].useformula = useformula

				if to.errorLastValue == expr(gsub(useformula, "x", 1)) or to.last_value == expr(gsub(useformula, "x", 1)) then
					bucket("debug2").put{msg="Formula doesn't start immediatelly after last value -> {{pp|"..(args[1] or "").."|"..(args[2] or "").."|"..(args["label1"] or args["type"] or "level").."}}"}
					debug2 = true
				end

	            for x = 1, times+extendedSize do
	                resulttable[orig_index][to.x_filling + x - 1] = rounding(expr(gsub(useformula, "x", x)), round[orig_index])
	            end
	        end
		end
    end

    if #resulttable[2] ~= 0 and #resulttable[1] ~= #resulttable[2] then
    	return userError("Variables are unmatched", "LuaError")
    end

    local s = builder.create()

    s:wikitext('<span class="pp-tooltip" style="position:relative; border-bottom:1px dotted; cursor:help;')

    if args["color"] then
        s:wikitext(" color:" .. require('Module:Color').keyword{args["color"]} .. ";")
    end

    s:wikitext('"')

    if args["label"] then
        s:wikitext(' data-bot-label="' .. args["label"] .. '"')
    end

    if (args["label1"] and args["label1"] ~= "level") or (args["type"] and args["type"] ~= "level") then
        s:wikitext(' data-top-label="' .. gsub(gsub(args["label1"] or args["type"], "'''", ""), "''", "") .. '"')
    end

	local displayMaxColumn

    if args["defaultDisplayMaxLevel"] == "true" then
    	if #resulttable[2] == 0 and #resulttable[1] > defaultSize then
    		displayMaxColumn = defaultSize
		else
	    	for i = #resulttable[2], 1, -1 do
	    		local v = tonumber(resulttable[2][i])
	    		if v == nil then
	    			break
	    		elseif v <= defaultSize then
	    			if i ~= #resulttable[2] then
	    				displayMaxColumn = i
	    			end

	    			break
	    		end
	    	end

			--avoiding redundant inputs
	    	if displayMaxColumn == nil then
	    		return userError('"defaultDisplayMaxLevel (true)" cannot be set when no level is higher than default')
	    	end
	    end
    else
    	displayMaxColumn = #resulttable[1]
    end

    if displayMaxColumn > defaultSize and fill.fillingToDefault then
		displayMaxColumn = defaultSize
    end

	local defaultTopScaling = false

    if resulttable[2][1] == nil then
    	defaultTopScaling = true
    elseif origtable[2][2] == nil then
    	if save_formula_variables[2].useformula == "x" then
    		defaultTopScaling = true
    	elseif save_formula_variables[2].start == 1 then
    		local scale2 = (save_formula_variables[2].finish - save_formula_variables[2].start) / (originalInputSize - 1)
    		if scale2 == 1 then
    			defaultTopScaling = true
    		end
    	end
    end

    if args["formula"] then
        s:wikitext(' data-displayformula="' .. args["formula"] .. '"')
    elseif origtable[1][2] == nil then
    	if save_formula_variables[1].useformula and defaultTopScaling then
	    	s:wikitext(' data-useformula="' .. save_formula_variables[1].useformula .. '"')
	    elseif save_formula_variables[1].start and (defaultTopScaling or (save_formula_variables[2].start and origtable[2][2] == nil)) then
	        s:wikitext(
	            ' data-start="' .. (save_formula_variables[1].start or "") .. ';' .. (save_formula_variables[2].start or "") .. '"' ..
	            ' data-finish="' .. (save_formula_variables[1].finish or "") .. ';' .. (save_formula_variables[2].finish or "") .. '"' ..
	            ' data-top-fill="' .. originalInputSize .. '"')
	        --top-fill had some other purpose some time ago, but i'm now using it as a generic size from the original input
        end
    end

    local additionalTooltipParams = builder.create()
    if displayMaxColumn < #resulttable[1] then
    	additionalTooltipParams:wikitext("|displayMaxColumn="..displayMaxColumn)
    end

    if resulttable[1][1] then
        s:wikitext(' data-bot-values="' .. concat(resulttable[1],";") .. tostring(additionalTooltipParams) .. '"')
    end

    if not defaultTopScaling then
        s:wikitext(' data-top-values="' .. concat(resulttable[2],";") .. '"')
    end

    if args["key"] then
        s:wikitext(' data-bot-key="' .. args["key"] .. '"')
    end

    if args["key1"] then
        s:wikitext(' data-top-key="' .. args["key1"] .. '"')
    end

    s:wikitext(">")

    if (displayMaxColumn > 5 and args["changedisplay"] ~= "true") or (displayMaxColumn <= 5 and args["changedisplay"] == "true") then
        s:wikitext(fd{resulttable[1][1] or "NULL"} .. (args["key"] or "") .. " – " .. fd{resulttable[1][displayMaxColumn] or "NULL"}  .. (args["key"] or ""))
    else
        s:wikitext(fdmulti{concat(resulttable[1], (args["key"] or "") .. " / ", 1, displayMaxColumn)} .. (args["key"] or ""))
    end

    if args["showtype"] ~= "false" then
        s:wikitext(" (based on " .. (args["type"] or args["label1"] or "level") .. ")")
    end

    s:wikitext("</span>")

	local displayMaxColumn
	if #resulttable[2] == 0 and #resulttable[1] > defaultSize then
		displayMaxColumn = defaultSize
	else
    	for i = #resulttable[2], 1, -1 do
    		local v = tonumber(resulttable[2][i])
    		if v == nil then
    			break
    		elseif v <= defaultSize then
    			if i ~= #resulttable[2] then
    				displayMaxColumn = i
    			end

    			break
    		end
    	end
	end

    if displayMaxColumn ~= nil and originalInputSize > displayMaxColumn then
    	bucket("debug").put{msg="{{pp|"..(args[1] or "").."|"..(args[2] or "").."|"..(args["label1"] or args["type"] or "level").."}}"}
	    s:wikitext("[[Category:Debug]]")
    end

    if debug2 then
    	s:wikitext("[[Category:Debug2]]")
    end

    return tostring(s)
end

function p.ap(frame)
    local args = lib.frameOrParentArguments{frame = frame} or frame

	local userError = require('Module:User error')
    local orig  	= args
    local count 	= 6
    local round 	= args["round"] or nil
    args["key"] = args["key"] or ""
	local fill		= (args["skill"] ~= "R" and 5) or 3

    local resulttable = {}
    local len_resulttable = 0
	local i = 1

    while orig[i] and orig[i] ~= "" do
    	local temp_find_to = find(orig[i], "to", 1, true)
		local temp_find_x = find(orig[i], "x", 1, true)

        if (temp_find_to or temp_find_x) and find(orig[i], "<", 1, true) == nil then
        	local start, finish, times

        	if temp_find_to then
	        	start = sub(orig[i], 1, temp_find_to - 1)
	            finish, times = orig[i]:match".* *to *([^ ]*) *([^ ]*)$"
	        end

            start, finish, times = start or "", finish or "", times or ""
            local check_for_times = false

            if temp_find_x == nil and pcall(expr, start .. "*2") and pcall(expr, finish .. "*2") and
            (pcall(expr, times .. "*2") or times == "") then
            	check_for_times = true
                start = expr(start)
                finish = expr(finish)

                if times == "" then
                    if fill ~= 0 then
                        times = fill
                        fill = 0
                    else
                        check_for_times = false
                    end
                else
                    times = expr(times)
                end

                if check_for_times then
                    count = count - times

                    if count < 0 then
                        return userError("Maximum size exceeded", "LuaError")
                    end

                    local scale = (finish - start) / (times - 1)
                    local formula = start - scale

                    for x = 1, times do
                        formula = formula + scale
                        len_resulttable = len_resulttable + 1
                        resulttable[len_resulttable] = rounding(formula, round)
                    end
                end
            else
                local useformula,times = orig[i]:match"(.*[0-9x%)]) +([^ ]*)$"
				useformula, times = useformula or orig[i], times or ""

				if pcall(expr, times .. "*2") then
					check_for_times = true
					times = expr(times)
				elseif times == "" and fill ~= 0 then
					check_for_times = true
                    times = fill
                    fill = 0
	            end

                local _,occurences = gsub(orig[i],"to","")

                if check_for_times and occurences > 0 then
                    useformula = gsub(string_to_formula(useformula),"times",tostring(times))
                end

                if check_for_times and pcall(expr, gsub(useformula, "([%.%d]?)x([%.%d]?)", gsub_x) .. "*2") then
                    count = count - times

                    if count < 0 then
                        return userError("Maximum size exceeded", "LuaError")
                    end

                    for x = 1, times do
                    	len_resulttable = len_resulttable + 1
                        resulttable[len_resulttable] =  rounding(expr(gsub(useformula, "x", x)), round)
                    end
                else
                    check_for_times = false
                end
            end

            if check_for_times == false then
                count = count - 1

                if count < 0 then
                    return userError("Maximum size exceeded", "LuaError")
                end

				len_resulttable = len_resulttable + 1
                resulttable[len_resulttable] = orig[i]
            end
        else
            count = count - 1

            if count < 0 then
                return userError("Maximum size exceeded", "LuaError")
            end

            local value = (pcall(expr, orig[i] .. "*2") and rounding(orig[i], round)) or orig[i]

			len_resulttable = len_resulttable + 1
            resulttable[len_resulttable] = value
        end

        i = i + 1
    end

    return fdmulti{concat(resulttable, args["key"] .. " / ")} .. args["key"]
end

--generic function that doesn't do any processing other than delimit the values
function p.dv(frame)
	local args = lib.frameOrParentArguments{frame = frame} or frame
	return concat(args," • ") -- bullet point character, Alt+0149
end

return p

-- </pre>
--[[Category:Lua]]
